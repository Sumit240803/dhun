import type { Server } from 'http';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { buildGateway, shutdownGateway } from '../src/gateway/server.js';
import type { ServerMessage } from '../src/gateway/protocol.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'gw-device-00001', platform: 'android' };
const PASSWORD = 'correct horse battery';

let server: Server;
let wss: ReturnType<typeof buildGateway>['wss'];
let url: string;
let counter = 0;

/**
 * A test client over a real socket.
 *
 * Deliberately not a mock. The interesting failures here are protocol
 * failures — a frame arriving before the handshake, a message for a room the
 * socket never joined — and none of them exist above the wire.
 */
class TestClient {
  private socket: WebSocket;
  private inbox: ServerMessage[] = [];

  constructor() {
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw) => {
      this.inbox.push(JSON.parse(raw.toString()) as ServerMessage);
    });
  }

  async open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Waits for the next message of a type. Fails the test rather than hanging. */
  async next<T extends ServerMessage['t']>(
    type: T,
    timeoutMs = 4000,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.inbox.find((m) => m.t === type);
      if (found) {
        this.inbox = this.inbox.filter((m) => m !== found);
        return found as Extract<ServerMessage, { t: T }>;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for "${type}"`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  received(type: ServerMessage['t']): boolean {
    return this.inbox.some((m) => m.t === type);
  }

  async closed(): Promise<number> {
    if (this.socket.readyState === WebSocket.CLOSED) return 0;
    return new Promise((resolve) => this.socket.once('close', (code) => resolve(code)));
  }

  close(): void {
    this.socket.close();
  }
}

async function account() {
  const res = await request(app)
    .post('/v1/auth/email/register')
    .send({
      email: `gw${counter++}.${Date.now()}@example.com`,
      password: PASSWORD,
      device: { ...DEVICE, deviceId: `gwd-${counter}-${Date.now()}` },
    })
    .expect(201);
  return res.body as { accessToken: string; user: { id: string } };
}

async function goLive(host: { accessToken: string }) {
  const res = await request(app)
    .post('/v1/rooms/live')
    .set('Authorization', `Bearer ${host.accessToken}`)
    .send({ title: 'Gateway test', tag: 'chatting', seatCapacity: 4 })
    .expect(201);
  return (res.body as { room: { id: string } }).room.id;
}

/** Connected AND authenticated — the state every test past the handshake needs. */
async function connected(token: string): Promise<TestClient> {
  const client = new TestClient();
  await client.open();
  client.send({ t: 'auth', token });
  await client.next('ready');
  return client;
}

beforeAll(async () => {
  const built = buildGateway();
  server = built.server;
  wss = built.wss;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});

afterAll(async () => {
  await shutdownGateway(wss);
  server.close();
  await closePool();
});

beforeEach(async () => {
  await resetLedger();
  await resetRateLimits();
  vi.spyOn(LiveKitProvider.prototype, 'setParticipantGrants').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
});

afterEach(() => vi.restoreAllMocks());

describe('the handshake', () => {
  it('refuses anything before auth', async () => {
    // A socket carries no authority of its own. Accepting a join first would
    // mean the room is entered by whoever asked, not by whoever proved who
    // they are.
    const client = new TestClient();
    await client.open();
    client.send({ t: 'join', roomId: '00000000-0000-4000-8000-000000000000' });
    expect(await client.closed()).toBe(4001);
  });

  it('refuses a bad token', async () => {
    const client = new TestClient();
    await client.open();
    client.send({ t: 'auth', token: 'not-a-real-token-at-all' });
    const error = await client.next('error');
    expect(error.code).toBe('INVALID_TOKEN');
    client.close();
  });

  it('accepts a valid one', async () => {
    const user = await account();
    const client = await connected(user.accessToken);
    client.close();
  });

  it('ignores a malformed frame without dropping the socket', async () => {
    // A buggy client should get an error, not a disconnect that it will
    // reconnect from and repeat.
    const user = await account();
    const client = await connected(user.accessToken);

    client.send({ t: 'chat' }); // no roomId, no body
    const error = await client.next('error');
    expect(error.code).toBe('BAD_MESSAGE');
    client.close();
  });
});

describe('joining a room', () => {
  it('returns the seats, the backlog and the viewer count', async () => {
    const host = await account();
    const roomId = await goLive(host);
    const client = await connected(host.accessToken);

    client.send({ t: 'join', roomId });
    const joined = await client.next('joined');

    expect(joined.roomId).toBe(roomId);
    expect(joined.seats[0]).toMatchObject({ seatIndex: 0, userId: host.user.id });
    expect(joined.viewers).toBe(1);
    expect(joined.history).toEqual([]);
    client.close();
  });

  it('gives the mic queue to the host and nobody else', async () => {
    // The queue names everyone who asked to speak. Publishing it would tell
    // the room who was refused.
    const host = await account();
    const viewer = await account();
    const roomId = await goLive(host);

    const hostClient = await connected(host.accessToken);
    hostClient.send({ t: 'join', roomId });
    expect((await hostClient.next('joined')).micQueue).toEqual([]);

    const viewerClient = await connected(viewer.accessToken);
    viewerClient.send({ t: 'join', roomId });
    expect((await viewerClient.next('joined')).micQueue).toBeUndefined();

    hostClient.close();
    viewerClient.close();
  });

  it('refuses a room that has ended', async () => {
    const host = await account();
    const roomId = await goLive(host);
    await request(app)
      .post(`/v1/rooms/${roomId}/end`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .expect(200);

    const client = await connected(host.accessToken);
    client.send({ t: 'join', roomId });
    expect((await client.next('error')).code).toBe('ROOM_ENDED');
    client.close();
  });

  it('refuses somebody the host kicked', async () => {
    const host = await account();
    const pest = await account();
    const roomId = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${roomId}/kick/${pest.user.id}`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({})
      .expect(200);

    const client = await connected(pest.accessToken);
    client.send({ t: 'join', roomId });
    expect((await client.next('error')).code).toBe('ROOM_BANNED');
    client.close();
  });
});

describe('chat', () => {
  it('reaches everyone in the room, including the sender', async () => {
    const host = await account();
    const viewer = await account();
    const roomId = await goLive(host);

    const hostClient = await connected(host.accessToken);
    const viewerClient = await connected(viewer.accessToken);
    hostClient.send({ t: 'join', roomId });
    viewerClient.send({ t: 'join', roomId });
    await hostClient.next('joined');
    await viewerClient.next('joined');

    hostClient.send({ t: 'chat', roomId, body: 'hello everyone' });

    // The sender sees their own line, and sees it without waiting for a Redis
    // round trip — that is what makes chat feel instant.
    expect((await hostClient.next('chat')).line.body).toBe('hello everyone');
    expect((await viewerClient.next('chat')).line.body).toBe('hello everyone');

    hostClient.close();
    viewerClient.close();
  });

  it('persists what was said', async () => {
    // A report is worthless without the message it is about, and the reporter
    // cannot be asked to screenshot it.
    const host = await account();
    const roomId = await goLive(host);
    const client = await connected(host.accessToken);
    client.send({ t: 'join', roomId });
    await client.next('joined');

    client.send({ t: 'chat', roomId, body: 'on the record' });
    await client.next('chat');

    const { rows } = await pool.query<{ body: string; verdict: string }>(
      'SELECT body, verdict FROM room_messages WHERE room_id = $1',
      [roomId],
    );
    expect(rows).toEqual([{ body: 'on the record', verdict: 'clean' }]);
    client.close();
  });

  it('blocks abuse, tells only the sender, and still records it', async () => {
    const host = await account();
    const viewer = await account();
    const roomId = await goLive(host);

    const hostClient = await connected(host.accessToken);
    const viewerClient = await connected(viewer.accessToken);
    hostClient.send({ t: 'join', roomId });
    viewerClient.send({ t: 'join', roomId });
    await hostClient.next('joined');
    await viewerClient.next('joined');

    hostClient.send({ t: 'chat', roomId, body: 'bhosdike' });
    expect((await hostClient.next('error')).code).toBe('MESSAGE_BLOCKED');

    // Nobody else saw it.
    await new Promise((r) => setTimeout(r, 200));
    expect(viewerClient.received('chat')).toBe(false);

    // But it is on record — with the ORIGINAL text, which is what a moderator
    // reviewing an appeal needs.
    const { rows } = await pool.query<{ body: string; verdict: string }>(
      'SELECT body, verdict FROM room_messages WHERE room_id = $1',
      [roomId],
    );
    expect(rows).toEqual([{ body: 'bhosdike', verdict: 'blocked' }]);

    hostClient.close();
    viewerClient.close();
  });

  it('refuses a room the socket never joined', async () => {
    // Otherwise knowing a room id is enough to post into it.
    const host = await account();
    const stranger = await account();
    const roomId = await goLive(host);

    const client = await connected(stranger.accessToken);
    client.send({ t: 'chat', roomId, body: 'sneaking in' });
    expect((await client.next('error')).code).toBe('NOT_IN_ROOM');
    client.close();
  });
});

describe('the mic queue', () => {
  it('reaches the host, and grants a seat on approval', async () => {
    const host = await account();
    const viewer = await account();
    const roomId = await goLive(host);

    const hostClient = await connected(host.accessToken);
    const viewerClient = await connected(viewer.accessToken);
    hostClient.send({ t: 'join', roomId });
    viewerClient.send({ t: 'join', roomId });
    await hostClient.next('joined');
    await viewerClient.next('joined');

    viewerClient.send({ t: 'mic:request', roomId });

    const queue = await hostClient.next('mic:queue');
    expect(queue.requests).toHaveLength(1);
    expect(queue.requests[0].userId).toBe(viewer.user.id);

    hostClient.send({ t: 'mic:resolve', roomId, userId: viewer.user.id, approve: true });

    // The requester is told, and the room's seat map updates.
    expect((await viewerClient.next('mic:resolved')).approved).toBe(true);
    const seats = await hostClient.next('seats');
    expect(seats.seats.some((s) => s.userId === viewer.user.id)).toBe(true);

    hostClient.close();
    viewerClient.close();
  });

  it('refuses anyone but the host resolving a request', async () => {
    // Re-checked against the database, not trusted from what the socket
    // last knew about itself.
    const host = await account();
    const a = await account();
    const b = await account();
    const roomId = await goLive(host);

    const client = await connected(a.accessToken);
    client.send({ t: 'join', roomId });
    await client.next('joined');

    client.send({ t: 'mic:resolve', roomId, userId: b.user.id, approve: true });
    expect((await client.next('error')).code).toBe('NOT_ROOM_HOST');
    client.close();
  });

  it('grants no seat when the host denies', async () => {
    const host = await account();
    const viewer = await account();
    const roomId = await goLive(host);

    const hostClient = await connected(host.accessToken);
    const viewerClient = await connected(viewer.accessToken);
    hostClient.send({ t: 'join', roomId });
    viewerClient.send({ t: 'join', roomId });
    await hostClient.next('joined');
    await viewerClient.next('joined');

    viewerClient.send({ t: 'mic:request', roomId });
    await hostClient.next('mic:queue');

    hostClient.send({ t: 'mic:resolve', roomId, userId: viewer.user.id, approve: false });
    expect((await viewerClient.next('mic:resolved')).approved).toBe(false);

    const { rows } = await pool.query(
      'SELECT 1 FROM room_seats WHERE room_id = $1 AND user_id = $2',
      [roomId, viewer.user.id],
    );
    expect(rows).toHaveLength(0);

    hostClient.close();
    viewerClient.close();
  });
});

describe('presence', () => {
  it('rises and falls as people come and go', async () => {
    const host = await account();
    const viewer = await account();
    const roomId = await goLive(host);

    const hostClient = await connected(host.accessToken);
    hostClient.send({ t: 'join', roomId });
    await hostClient.next('joined');
    // The host's own join broadcasts too, and they are in the room to hear it.
    // Consumed here so the assertion below reads the viewer's arrival rather
    // than this.
    expect((await hostClient.next('presence')).viewers).toBe(1);

    const viewerClient = await connected(viewer.accessToken);
    viewerClient.send({ t: 'join', roomId });
    await viewerClient.next('joined');

    expect((await hostClient.next('presence')).viewers).toBe(2);

    // A closing tab produces no media-server event at all, which is why
    // presence is counted here rather than from a webhook.
    viewerClient.close();
    expect((await hostClient.next('presence')).viewers).toBe(1);

    hostClient.close();
  });
});
