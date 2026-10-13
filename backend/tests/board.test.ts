import { randomUUID } from 'crypto';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import {
  ECONOMY,
  freeCoinGrantLegs,
  invalidateCatalogCache,
  postTransaction,
} from '../src/modules/economy/index.js';
import { rankFor, rollupRoomHour, topRooms } from '../src/modules/rooms/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'board-device-01', platform: 'android' };

let phoneCounter = 0;
const nextPhone = () => `+9198${String(50_000_000 + phoneCounter++).slice(-8)}`;

interface User {
  id: string;
  token: string;
}

async function adult(name = 'Host'): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { ...DEVICE, deviceId: `bd-${phone}` } })
    .expect(200);
  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name })
    .expect(200);
  return { id: res.body.user.id as string, token };
}

async function goLive(host: User) {
  const res = await request(app)
    .post('/v1/rooms/live')
    .set('Authorization', `Bearer ${host.token}`)
    .send({ title: 'Evening adda', tag: 'chatting' })
    .expect(201);
  return res.body.room as { id: string; publicId: number };
}

async function grantCoins(userId: string, coins: number) {
  await postTransaction({
    txnType: 'free_coin_grant',
    idempotencyKey: uuidv7(),
    identity: { source: 'signup' },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
    },
    legs: freeCoinGrantLegs({ userId, coins }),
  });
}

function gift(sender: User, roomId: string, recipientId: string, quantity = 1) {
  return request(app)
    .post('/v1/gifts/send')
    .set('Authorization', `Bearer ${sender.token}`)
    .set('Idempotency-Key', randomUUID())
    .send({ roomId, recipientId, giftId: 'rose', quantity, expectedCoinPrice: 90 });
}

beforeEach(async () => {
  await resetLedger();
  invalidateCatalogCache();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'mintJoinToken').mockReturnValue({
    token: 'test-token',
    url: 'wss://test',
    roomName: 'test',
    identity: 'test',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

afterEach(() => vi.restoreAllMocks());
afterAll(closePool);

describe('room codes', () => {
  it('gives every room a short number, distinct from its id', async () => {
    const host = await adult();
    const room = await goLive(host);

    expect(room.publicId).toBeGreaterThanOrEqual(100_001);
    // The whole point of migration 029: the number people quote is NOT the
    // string that identifies the row.
    expect(String(room.publicId)).not.toBe(room.id);
  });

  it('finds a live room by its code', async () => {
    const host = await adult();
    const room = await goLive(host);

    const found = await request(app).get(`/v1/rooms/code/${room.publicId}`).expect(200);
    expect(found.body.room.id).toBe(room.id);
  });

  it('does not find an ended room, or a code nobody has', async () => {
    // A code is quoted to send somebody to a broadcast that is HAPPENING.
    const host = await adult();
    const room = await goLive(host);
    await request(app)
      .post(`/v1/rooms/${room.id}/end`)
      .set('Authorization', `Bearer ${host.token}`)
      .expect(200);

    await request(app).get(`/v1/rooms/code/${room.publicId}`).expect(404);
    await request(app).get('/v1/rooms/code/999999').expect(404);
  });

  it('refuses a code outside the sequence shape', async () => {
    // An unbounded integer here is a free scan of the id space.
    await request(app).get('/v1/rooms/code/1').expect(422);
    await request(app).get('/v1/rooms/code/abc').expect(422);
  });
});

describe('the hourly board', () => {
  it('ranks rooms by what they earned this hour', async () => {
    const big = await adult('BigHost');
    const small = await adult('SmallHost');
    const bigRoom = await goLive(big);
    const smallRoom = await goLive(small);

    const fan = await adult('Asha');
    await grantCoins(fan.id, 100_000);
    await gift(fan, bigRoom.id, big.id, 99).expect(200);
    await gift(fan, smallRoom.id, small.id, 1).expect(200);

    await rollupRoomHour();

    const board = await topRooms();
    expect(board[0]!.roomId).toBe(bigRoom.id);
    expect(board[0]!.rank).toBe(1);
    expect(board[1]!.roomId).toBe(smallRoom.id);
    expect(board[1]!.rank).toBe(2);
  });

  it('tells a room how far it is from the place above', async () => {
    const leader = await adult('Leader');
    const chaser = await adult('Chaser');
    const leaderRoom = await goLive(leader);
    const chaserRoom = await goLive(chaser);

    const fan = await adult('Asha');
    await grantCoins(fan.id, 100_000);
    await gift(fan, leaderRoom.id, leader.id, 10).expect(200); // 900
    await gift(fan, chaserRoom.id, chaser.id, 1).expect(200); //   90

    await rollupRoomHour();

    const rank = await rankFor(chaserRoom.id);
    expect(rank?.position).toBe('2');
    expect(rank?.coins).toBe(90);
    expect(rank?.nextUpCoins).toBe(900);
    // 90 of 900 — a tenth of the way up the gap, and the bar says so.
    expect(rank?.progress).toBeCloseTo(0.1);
  });

  it('gives the leader no progress bar — there is nothing above to chase', async () => {
    const host = await adult();
    const room = await goLive(host);
    const fan = await adult('Asha');
    await grantCoins(fan.id, 50_000);
    await gift(fan, room.id, host.id, 1).expect(200);

    await rollupRoomHour();

    const rank = await rankFor(room.id);
    expect(rank?.position).toBe('1');
    expect(rank?.progress).toBeNull();
  });

  it('shows nothing for a room nobody has gifted in', async () => {
    // Not "rank 100+ with 0 coins". There is no encouragement in telling a
    // host they are last, so the rail hides instead.
    const host = await adult();
    const room = await goLive(host);
    await rollupRoomHour();

    expect(await rankFor(room.id)).toBeNull();

    const res = await request(app).get(`/v1/rooms/${room.id}/rank`).expect(200);
    expect(res.body.rank).toBeNull();
  });

  it('is idempotent — a second rollup changes nothing', async () => {
    const host = await adult();
    const room = await goLive(host);
    const fan = await adult('Asha');
    await grantCoins(fan.id, 50_000);
    await gift(fan, room.id, host.id, 10).expect(200);

    await rollupRoomHour();
    const first = await rankFor(room.id);
    await rollupRoomHour();
    const second = await rankFor(room.id);

    expect(second).toEqual(first);
  });

  it('ignores gifts from a previous hour', async () => {
    const host = await adult();
    const room = await goLive(host);
    const fan = await adult('Asha');
    await grantCoins(fan.id, 50_000);
    await gift(fan, room.id, host.id, 10).expect(200);

    // The board resets on the hour, and that reset is what makes "18% to the
    // next place" worth chasing rather than a number that only ever grows.
    // gift_sends is append-only, so backdating needs the trigger off.
    await pool.query('ALTER TABLE gift_sends DISABLE TRIGGER trg_gift_sends_immutable');
    await pool.query("UPDATE gift_sends SET created_at = now() - interval '2 hours'");
    await pool.query('ALTER TABLE gift_sends ENABLE TRIGGER trg_gift_sends_immutable');

    await rollupRoomHour();
    expect(await rankFor(room.id)).toBeNull();
  });
});
