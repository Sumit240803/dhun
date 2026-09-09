import { createHash } from 'crypto';
import { decodeJwt } from 'jose';
import { AccessToken } from 'livekit-server-sdk';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'room-device-0001', platform: 'android' };
const PASSWORD = 'correct horse battery';

const KEY = 'testkey';
const SECRET = 'test-secret-at-least-32-characters-long';

let counter = 0;
const nextEmail = () => `room${counter++}.${Date.now()}@example.com`;

interface Account {
  accessToken: string;
  user: { id: string };
}

/**
 * A registered account. Registered rather than guest because hosting and
 * taking a seat both require one — a guest may watch and nothing else.
 */
async function account(): Promise<Account> {
  const res = await request(app)
    .post('/v1/auth/email/register')
    .send({
      email: nextEmail(),
      password: PASSWORD,
      device: { ...DEVICE, deviceId: `rd-${counter}-${Date.now()}` },
    })
    .expect(201);
  return res.body as Account;
}

/**
 * Stubs the media server.
 *
 * Token MINTING is deliberately left real — it is local crypto, it is where the
 * publish grant is decided, and it is the one thing here worth asserting on
 * directly. Only the outbound calls are stubbed, which is the boundary that
 * needs a running LiveKit.
 */
function stubMedia() {
  vi.spyOn(LiveKitProvider.prototype, 'setParticipantGrants').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'muteParticipant').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'removeParticipant').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
}

/** The grants actually inside a minted join token. */
function grantsIn(token: string) {
  return (decodeJwt(token) as { video?: Record<string, unknown> }).video ?? {};
}

async function goLive(host: Account, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/v1/rooms/live')
    .set('Authorization', `Bearer ${host.accessToken}`)
    .send({ title: 'Evening adda', tag: 'chatting', seatCapacity: 4, ...body })
    .expect(201);
  return res.body as { room: { id: string }; rtc: { token: string; url: string } };
}

/** Signs a webhook exactly as LiveKit does: a JWT carrying the body's digest. */
async function signedWebhook(body: unknown): Promise<{ raw: string; header: string }> {
  const raw = JSON.stringify(body);
  const at = new AccessToken(KEY, SECRET, { ttl: 60 });
  at.sha256 = createHash('sha256').update(raw).digest('base64');
  return { raw, header: await at.toJwt() };
}

function postWebhook(raw: string, header?: string) {
  const req = request(app)
    .post('/v1/webhooks/livekit')
    .set('Content-Type', 'application/webhook+json');
  if (header) req.set('Authorization', header);
  return req.send(raw);
}

beforeEach(async () => {
  await resetLedger();
  await resetRateLimits();
  stubMedia();
});

afterEach(() => vi.restoreAllMocks());
afterAll(closePool);

describe('going live', () => {
  it('creates the room and returns a token that can speak', async () => {
    const host = await account();
    const { room, rtc } = await goLive(host);

    expect(rtc.url).toBe('ws://livekit.test:7880');

    const grants = grantsIn(rtc.token);
    expect(grants.room).toBe(`dhun-${room.id}`);
    expect(grants.canPublish).toBe(true);
    // The host talks through our API for everything else. A client that can
    // broadcast raw data has routed around moderation, persistence and billing.
    expect(grants.canPublishData).toBe(false);
    expect(grants.roomAdmin).toBeUndefined();
  });

  it('reserves seat 0 for the host', async () => {
    const host = await account();
    const { room } = await goLive(host);

    const { rows } = await pool.query<{ seat_index: number; user_id: string }>(
      'SELECT seat_index, user_id FROM room_seats WHERE room_id = $1',
      [room.id],
    );
    expect(rows).toEqual([{ seat_index: 0, user_id: host.user.id }]);
  });

  it('refuses a second live room rather than replacing the first', async () => {
    // A reconnect storm would otherwise churn through rooms and scatter an
    // audience the host spent an hour gathering.
    const host = await account();
    const first = await goLive(host);

    const res = await request(app)
      .post('/v1/rooms/live')
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({ title: 'Second', tag: 'chatting' })
      .expect(409);

    expect(res.body.error.code).toBe('ALREADY_LIVE');

    const still = await pool.query('SELECT 1 FROM rooms WHERE id = $1 AND ended_at IS NULL', [
      first.room.id,
    ]);
    expect(still.rowCount).toBe(1);
  });

  it('is closed to guests', async () => {
    const guest = await request(app)
      .post('/v1/auth/guest')
      .send({ device: { ...DEVICE, deviceId: 'room-guest-0001' } })
      .expect(201);

    await request(app)
      .post('/v1/rooms/live')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .send({ title: 'Nope', tag: 'chatting' })
      .expect(403);
  });
});

describe('joining', () => {
  it('gives a listener a token that cannot publish', async () => {
    // The single most important assertion in this file. LiveKit treats an
    // OMITTED canPublish as permission to publish, so a listener token that
    // merely forgets the field lets anyone talk in anyone's room.
    const host = await account();
    const viewer = await account();
    const { room } = await goLive(host);

    const res = await request(app)
      .post(`/v1/rooms/${room.id}/join`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(200);

    expect(res.body.canPublish).toBe(false);
    expect(grantsIn(res.body.rtc.token).canPublish).toBe(false);
    expect(grantsIn(res.body.rtc.token).canSubscribe).toBe(true);
  });

  it('returns speaking rights to someone who already holds a seat', async () => {
    // A tunnel should cost you a few seconds, not your place on stage.
    const host = await account();
    const speaker = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/join`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .expect(200);
    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(200);

    const rejoin = await request(app)
      .post(`/v1/rooms/${room.id}/join`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .expect(200);

    expect(rejoin.body.canPublish).toBe(true);
    expect(grantsIn(rejoin.body.rtc.token).canPublish).toBe(true);
  });

  it('refuses an ended room with 410 rather than 404', async () => {
    const host = await account();
    const viewer = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/end`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .expect(200);

    const res = await request(app)
      .post(`/v1/rooms/${room.id}/join`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .expect(410);

    expect(res.body.error.code).toBe('ROOM_ENDED');
  });
});

describe('seats', () => {
  it('lets only one person hold a seat', async () => {
    const host = await account();
    const first = await account();
    const second = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${first.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(200);

    const res = await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${second.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(409);

    expect(res.body.error.code).toBe('SEAT_TAKEN');
  });

  it('settles a simultaneous grab with exactly one winner', async () => {
    // The primary key decides it, not a read-then-write — which is what would
    // let two people both be granted the microphone.
    const host = await account();
    const { room } = await goLive(host);
    const contenders = await Promise.all([account(), account(), account(), account()]);

    const results = await Promise.all(
      contenders.map((c) =>
        request(app)
          .post(`/v1/rooms/${room.id}/seats`)
          .set('Authorization', `Bearer ${c.accessToken}`)
          .send({ seatIndex: 2 }),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);

    const { rows } = await pool.query('SELECT 1 FROM room_seats WHERE room_id = $1 AND seat_index = 2', [
      room.id,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("refuses the host's seat", async () => {
    const host = await account();
    const other = await account();
    const { room } = await goLive(host);

    const res = await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ seatIndex: 0 })
      .expect(403);

    expect(res.body.error.code).toBe('SEAT_RESERVED');
  });

  it('refuses a seat beyond the room capacity', async () => {
    const host = await account();
    const other = await account();
    const { room } = await goLive(host, { seatCapacity: 4 });

    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ seatIndex: 9 })
      .expect(422);
  });

  it('releases the seat when the media server refuses the grant', async () => {
    // Otherwise the user visibly holds a seat they cannot speak from, with no
    // way out except leaving the room.
    vi.spyOn(LiveKitProvider.prototype, 'setParticipantGrants').mockRejectedValue(
      new Error('media server down'),
    );

    const host = await account();
    const speaker = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(503);

    const seats = await pool.query('SELECT 1 FROM room_seats WHERE room_id = $1 AND seat_index = 1', [
      room.id,
    ]);
    expect(seats.rows).toHaveLength(0);

    // And the denormalised counter went back too, or the room would claim a
    // seat was taken forever.
    const { rows } = await pool.query<{ seats_taken: number }>(
      'SELECT seats_taken FROM rooms WHERE id = $1',
      [room.id],
    );
    expect(rows[0].seats_taken).toBe(1); // the host's seat only
  });

  it('lets a speaker leave, and the host remove them', async () => {
    const host = await account();
    const speaker = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(200);

    await request(app)
      .delete(`/v1/rooms/${room.id}/seats/${speaker.user.id}`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .expect(200);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(200);

    await request(app)
      .delete(`/v1/rooms/${room.id}/seats/${speaker.user.id}`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .expect(200);
  });

  it('refuses a stranger removing somebody from a seat', async () => {
    const host = await account();
    const speaker = await account();
    const stranger = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(200);

    const res = await request(app)
      .delete(`/v1/rooms/${room.id}/seats/${speaker.user.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .expect(403);

    expect(res.body.error.code).toBe('NOT_ROOM_HOST');
  });

  it('persists a host mute, so reconnecting does not undo it', async () => {
    const host = await account();
    const speaker = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(200);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats/${speaker.user.id}/mute`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({ muted: true })
      .expect(200);

    const { rows } = await pool.query<{ muted: boolean }>(
      'SELECT muted FROM room_seats WHERE room_id = $1 AND user_id = $2',
      [room.id, speaker.user.id],
    );
    expect(rows[0].muted).toBe(true);
  });
});

describe('kicking', () => {
  it('bars them from rejoining, which is the part that lasts', async () => {
    // Disconnecting alone is cosmetic — the SDK reconnects in seconds.
    const host = await account();
    const pest = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${pest.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(200);

    await request(app)
      .post(`/v1/rooms/${room.id}/kick/${pest.user.id}`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({ reason: 'abuse' })
      .expect(200);

    const res = await request(app)
      .post(`/v1/rooms/${room.id}/join`)
      .set('Authorization', `Bearer ${pest.accessToken}`)
      .expect(403);
    expect(res.body.error.code).toBe('ROOM_BANNED');

    // And their seat went with them.
    const seats = await pool.query('SELECT 1 FROM room_seats WHERE room_id = $1 AND user_id = $2', [
      room.id,
      pest.user.id,
    ]);
    expect(seats.rows).toHaveLength(0);
  });

  it('does not touch the account itself', async () => {
    // A host clearing their own room is not a platform judgement. Letting it
    // become one would hand every host the power to suspend a user.
    const host = await account();
    const pest = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/kick/${pest.user.id}`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .send({})
      .expect(200);

    const { rows } = await pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
      pest.user.id,
    ]);
    expect(rows[0].status).toBe('active');
  });

  it('refuses a non-host', async () => {
    const host = await account();
    const a = await account();
    const b = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/kick/${b.user.id}`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({})
      .expect(403);
  });
});

describe('ending a room', () => {
  it('clears the seats and is idempotent', async () => {
    const host = await account();
    const speaker = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(200);

    await request(app)
      .post(`/v1/rooms/${room.id}/end`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .expect(200);
    // A retry after a dropped response is ordinary, not an error.
    await request(app)
      .post(`/v1/rooms/${room.id}/end`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .expect(200);

    const seats = await pool.query('SELECT 1 FROM room_seats WHERE room_id = $1', [room.id]);
    expect(seats.rows).toHaveLength(0);

    const { rows } = await pool.query<{ ended_reason: string }>(
      'SELECT ended_reason FROM rooms WHERE id = $1',
      [room.id],
    );
    expect(rows[0].ended_reason).toBe('host');
  });

  it('refuses anyone but the host', async () => {
    const host = await account();
    const other = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/end`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(403);
  });

  it('still succeeds when the media server cannot be reached', async () => {
    // The room is already gone from the feed. Failing now would tell the host
    // their room is live when nobody can see it.
    vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockRejectedValue(new Error('down'));

    const host = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/end`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .expect(200);
  });
});

describe('webhooks', () => {
  it('refuses an unsigned request', async () => {
    const { raw } = await signedWebhook({ event: 'room_started', room: { name: 'dhun-x' } });
    await postWebhook(raw).expect(401);
  });

  it('refuses a body that does not match its signature', async () => {
    // The signature covers a digest of the body, so tampering is caught even
    // though the JWT itself is still perfectly valid.
    const { header } = await signedWebhook({ event: 'room_started', room: { name: 'dhun-a' } });
    await postWebhook(JSON.stringify({ event: 'room_finished', room: { name: 'dhun-b' } }), header)
      .expect(401);
  });

  it('sets the viewer count from the event rather than counting', async () => {
    // Absolute, not a delta: a missed event self-heals on the next one, where
    // an incremented counter would drift forever.
    const host = await account();
    const { room } = await goLive(host);

    const { raw, header } = await signedWebhook({
      event: 'participant_joined',
      room: { name: `dhun-${room.id}`, numParticipants: 37 },
      participant: { identity: 'someone-else' },
    });
    await postWebhook(raw, header).expect(200);

    const { rows } = await pool.query<{ viewer_count: number }>(
      'SELECT viewer_count FROM rooms WHERE id = $1',
      [room.id],
    );
    expect(rows[0].viewer_count).toBe(37);
  });

  it('opens one session stretch when the host connects, however many events arrive', async () => {
    const host = await account();
    const { room } = await goLive(host);

    for (let i = 0; i < 3; i++) {
      const { raw, header } = await signedWebhook({
        event: 'participant_joined',
        room: { name: `dhun-${room.id}`, numParticipants: 1 },
        participant: { identity: host.user.id },
      });
      await postWebhook(raw, header).expect(200);
    }

    const { rows } = await pool.query(
      'SELECT 1 FROM room_sessions WHERE room_id = $1 AND ended_at IS NULL',
      [room.id],
    );
    expect(rows).toHaveLength(1);
  });

  it('closes the stretch when the host drops, without ending the room', async () => {
    // A tunnel is not a decision to stop broadcasting.
    const host = await account();
    const { room } = await goLive(host);

    const join = await signedWebhook({
      event: 'participant_joined',
      room: { name: `dhun-${room.id}`, numParticipants: 1 },
      participant: { identity: host.user.id },
    });
    await postWebhook(join.raw, join.header).expect(200);

    const leave = await signedWebhook({
      event: 'participant_left',
      room: { name: `dhun-${room.id}`, numParticipants: 0 },
      participant: { identity: host.user.id },
    });
    await postWebhook(leave.raw, leave.header).expect(200);

    const sessions = await pool.query<{ ended_at: Date | null }>(
      'SELECT ended_at FROM room_sessions WHERE room_id = $1',
      [room.id],
    );
    expect(sessions.rows[0].ended_at).not.toBeNull();

    const rooms = await pool.query<{ ended_at: Date | null }>(
      'SELECT ended_at FROM rooms WHERE id = $1',
      [room.id],
    );
    expect(rooms.rows[0].ended_at).toBeNull();
  });

  it('frees the seat of someone who disconnects', async () => {
    // Otherwise a speaker who closed the app holds a mic nobody can take.
    const host = await account();
    const speaker = await account();
    const { room } = await goLive(host);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats`)
      .set('Authorization', `Bearer ${speaker.accessToken}`)
      .send({ seatIndex: 1 })
      .expect(200);

    const { raw, header } = await signedWebhook({
      event: 'participant_left',
      room: { name: `dhun-${room.id}`, numParticipants: 1 },
      participant: { identity: speaker.user.id },
    });
    await postWebhook(raw, header).expect(200);

    const seats = await pool.query('SELECT 1 FROM room_seats WHERE room_id = $1 AND seat_index = 1', [
      room.id,
    ]);
    expect(seats.rows).toHaveLength(0);
  });

  it("never takes the host off their own seat when they disconnect", async () => {
    // Reported from a device: the host backed out of their own room, came
    // back, and was no longer on the mic. The REST path refuses to release the
    // host's seat (HOST_SEAT_FIXED); this path was deleting it anyway. Two
    // paths, one rule, and only one of them followed it.
    const host = await account();
    const { room } = await goLive(host);

    const { raw, header } = await signedWebhook({
      event: 'participant_left',
      room: { name: `dhun-${room.id}`, numParticipants: 0 },
      participant: { identity: host.user.id },
    });
    await postWebhook(raw, header).expect(200);

    const seats = await pool.query<{ seat_index: number }>(
      'SELECT seat_index FROM room_seats WHERE room_id = $1 AND user_id = $2',
      [room.id, host.user.id],
    );
    expect(seats.rows).toEqual([{ seat_index: 0 }]);

    // And rejoining puts them straight back on the mic, rather than into a
    // room they host and cannot speak in.
    const rejoin = await request(app)
      .post(`/v1/rooms/${room.id}/join`)
      .set('Authorization', `Bearer ${host.accessToken}`)
      .expect(200);
    expect(rejoin.body.canPublish).toBe(true);
  });

  it('ends the room on room_finished, recorded as a timeout', async () => {
    const host = await account();
    const { room } = await goLive(host);

    const { raw, header } = await signedWebhook({
      event: 'room_finished',
      room: { name: `dhun-${room.id}`, numParticipants: 0 },
    });
    await postWebhook(raw, header).expect(200);

    const { rows } = await pool.query<{ ended_at: Date | null; ended_reason: string }>(
      'SELECT ended_at, ended_reason FROM rooms WHERE id = $1',
      [room.id],
    );
    expect(rows[0].ended_at).not.toBeNull();
    expect(rows[0].ended_reason).toBe('timeout');
  });

  it('ignores an event for a room that is not ours', async () => {
    // Another app sharing the media server, or a stray from a test.
    const { raw, header } = await signedWebhook({
      event: 'room_finished',
      room: { name: 'someone-elses-room' },
    });
    await postWebhook(raw, header).expect(200);
  });

  it('ignores event types it does not handle', async () => {
    // LiveKit adds events over time, and a 500 on one would make it retry
    // forever.
    const host = await account();
    const { room } = await goLive(host);

    const { raw, header } = await signedWebhook({
      event: 'track_published',
      room: { name: `dhun-${room.id}`, numParticipants: 1 },
      participant: { identity: host.user.id },
    });
    await postWebhook(raw, header).expect(200);
  });
});
