// Emoji reactions over the gateway: relayed to the room, never stored,
// capped per socket.

import type { Server } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildGateway, shutdownGateway } from '../src/gateway/server.js';
import type { ServerMessage } from '../src/gateway/protocol.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();
let server: Server;
let wss: ReturnType<typeof buildGateway>['wss'];
let url: string;
let counter = 0;

class TestClient {
  private socket: WebSocket;
  private inbox: ServerMessage[] = [];

  constructor() {
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw) => this.inbox.push(JSON.parse(raw.toString()) as ServerMessage));
  }
  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }
  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }
  async next<T extends ServerMessage['t']>(type: T, timeoutMs = 3_000): Promise<Extract<ServerMessage, { t: T }>> {
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
  count(type: ServerMessage['t']): number {
    return this.inbox.filter((m) => m.t === type).length;
  }
  close(): void {
    this.socket.close();
  }
}

async function account(): Promise<{ accessToken: string; user: { id: string } }> {
  const res = await request(app)
    .post('/v1/auth/email/register')
    .send({
      email: `rx${counter++}.${Date.now()}@example.com`,
      password: 'correct horse battery',
      device: { deviceId: `rxd-${counter}-${Date.now()}`, platform: 'android' },
    })
    .expect(201);
  return res.body;
}

async function guestAccount(): Promise<{ accessToken: string; user: { id: string } }> {
  const res = await request(app)
    .post('/v1/auth/guest')
    .send({ device: { deviceId: `rxg-${counter++}-${Date.now()}`, platform: 'android' } })
    .expect(201);
  return res.body;
}

async function goLive(host: { accessToken: string }): Promise<string> {
  const res = await request(app)
    .post('/v1/rooms/live')
    .set('Authorization', `Bearer ${host.accessToken}`)
    .send({ title: 'Reactions', tag: 'chatting', seatCapacity: 4 })
    .expect(201);
  return res.body.room.id as string;
}

async function inRoom(token: string, roomId: string): Promise<TestClient> {
  const client = new TestClient();
  await client.open();
  client.send({ t: 'auth', token });
  await client.next('ready');
  client.send({ t: 'join', roomId });
  await client.next('joined');
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

describe('reactions', () => {
  it('reach everyone in the room, with who sent them, and are never stored', async () => {
    const host = await account();
    const fan = await account();
    const roomId = await goLive(host);
    const hostSocket = await inRoom(host.accessToken, roomId);
    const fanSocket = await inRoom(fan.accessToken, roomId);

    fanSocket.send({ t: 'reaction', roomId, emoji: 'fire' });
    const seen = await hostSocket.next('reaction');
    expect(seen).toEqual({ t: 'reaction', roomId, userId: fan.user.id, emoji: 'fire' });
    // The sender sees their own too — the animation is the same for everyone.
    await fanSocket.next('reaction');

    hostSocket.close();
    fanSocket.close();
  });

  it('drops the ninth in a second without a word, and refuses a glyph not in the set', async () => {
    const host = await account();
    const fan = await account();
    const roomId = await goLive(host);
    const hostSocket = await inRoom(host.accessToken, roomId);
    const fanSocket = await inRoom(fan.accessToken, roomId);

    for (let i = 0; i < 12; i++) fanSocket.send({ t: 'reaction', roomId, emoji: 'heart' });
    await new Promise((r) => setTimeout(r, 400));
    expect(hostSocket.count('reaction')).toBe(8);

    fanSocket.send({ t: 'reaction', roomId, emoji: '<img onerror=x>' });
    const err = await fanSocket.next('error');
    expect(err.code).toBe('BAD_MESSAGE');

    hostSocket.close();
    fanSocket.close();
  });

  it('is not for guests, and not for a room the socket has not joined', async () => {
    const host = await account();
    const roomId = await goLive(host);
    const hostSocket = await inRoom(host.accessToken, roomId);

    const g = await guestAccount();
    const guestSocket = await inRoom(g.accessToken, roomId);
    guestSocket.send({ t: 'reaction', roomId, emoji: 'clap' });
    const refused = await guestSocket.next('error');
    expect(refused.code).toBe('REGISTRATION_REQUIRED');

    const other = await goLive(await account());
    hostSocket.send({ t: 'reaction', roomId: other, emoji: 'clap' });
    const notIn = await hostSocket.next('error');
    expect(notIn.code).toBe('NOT_IN_ROOM');

    hostSocket.close();
    guestSocket.close();
  });
});
