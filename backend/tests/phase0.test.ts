// Phase 0's last pieces: room admins, the host's earnings, the share page.

import { randomUUID } from 'crypto';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { ECONOMY, freeCoinGrantLegs, postTransaction } from '../src/modules/economy/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { closePool, resetLedger } from './helpers.js';

vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return { ...actual, publishToRoom: () => undefined };
});

const app = buildApp();
let counter = 0;
const nextPhone = () => `+9188${String(20_000_000 + counter++).slice(-8)}`;

interface User {
  id: string;
  token: string;
}

async function adult(name = 'Asha'): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { deviceId: `p0-${randomUUID()}`, platform: 'android' } })
    .expect(200);
  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name })
    .expect(200);
  return { id: res.body.user.id as string, token };
}

async function guest(): Promise<User> {
  const res = await request(app)
    .post('/v1/auth/guest')
    .send({ device: { deviceId: `p0g-${randomUUID()}`, platform: 'android' } })
    .expect(201);
  return { id: res.body.user.id as string, token: res.body.accessToken as string };
}

const auth = (u: User) => ({ Authorization: `Bearer ${u.token}` });

async function goLive(host: User, seatCapacity = 8): Promise<{ id: string; publicId: number }> {
  const res = await request(app)
    .post('/v1/rooms/live')
    .set(auth(host))
    .send({ title: 'Evening adda', tag: 'chatting', seatCapacity })
    .expect(201);
  return { id: res.body.room.id as string, publicId: res.body.room.publicId as number };
}

async function sit(user: User, roomId: string, seatIndex: number): Promise<void> {
  await request(app).post(`/v1/rooms/${roomId}/join`).set(auth(user)).expect(200);
  await request(app).post(`/v1/rooms/${roomId}/seats`).set(auth(user)).send({ seatIndex }).expect(200);
}

async function grantCoins(userId: string, coins: number): Promise<void> {
  await postTransaction({
    txnType: 'free_coin_grant',
    idempotencyKey: uuidv7(),
    identity: { source: 'signup' },
    rates: { faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee, pointsPerRupee: ECONOMY.pointsPerRupee },
    legs: freeCoinGrantLegs({ userId, coins }),
  });
}

beforeEach(async () => {
  await resetLedger();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'muteParticipant').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'removeParticipant').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'setParticipantGrants').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());
afterAll(closePool);

describe('room admins', () => {
  it('are appointed by the host, listed on the room, and can mute and remove', async () => {
    const host = await adult('Host');
    const admin = await adult('Trusted');
    const noisy = await adult('Noisy');
    const room = await goLive(host);
    await sit(noisy, room.id, 1);

    // Not an admin yet: refused like anyone else.
    await request(app)
      .post(`/v1/rooms/${room.id}/seats/${noisy.id}/mute`)
      .set(auth(admin))
      .send({ muted: true })
      .expect(403);

    const appointed = await request(app)
      .post(`/v1/rooms/${room.id}/admins`)
      .set(auth(host))
      .send({ userId: admin.id })
      .expect(200);
    expect(appointed.body.admins).toEqual([admin.id]);

    const detail = await request(app).get(`/v1/rooms/${room.id}`).expect(200);
    expect(detail.body.admins).toEqual([admin.id]);
    const joined = await request(app).post(`/v1/rooms/${room.id}/join`).set(auth(admin)).expect(200);
    expect(joined.body.admins).toEqual([admin.id]);

    await request(app)
      .post(`/v1/rooms/${room.id}/seats/${noisy.id}/mute`)
      .set(auth(admin))
      .send({ muted: true })
      .expect(200);
    await request(app).post(`/v1/rooms/${room.id}/kick/${noisy.id}`).set(auth(admin)).send({}).expect(200);
    const { rows } = await pool.query('SELECT banned_by FROM room_bans WHERE room_id = $1 AND user_id = $2', [
      room.id,
      noisy.id,
    ]);
    expect(rows[0].banned_by).toBe(admin.id);
  });

  it('cannot touch the host or another admin; only the host appoints and removes', async () => {
    const host = await adult('Host');
    const a = await adult('Admin A');
    const b = await adult('Admin B');
    const room = await goLive(host);
    for (const admin of [a, b]) {
      await request(app).post(`/v1/rooms/${room.id}/admins`).set(auth(host)).send({ userId: admin.id }).expect(200);
    }
    await sit(b, room.id, 2);

    const onHost = await request(app).post(`/v1/rooms/${room.id}/kick/${host.id}`).set(auth(a)).send({}).expect(409);
    expect(onHost.body.error.code).toBe('CANNOT_KICK_HOST');
    const onAdmin = await request(app)
      .post(`/v1/rooms/${room.id}/seats/${b.id}/mute`)
      .set(auth(a))
      .send({ muted: true })
      .expect(403);
    expect(onAdmin.body.error.code).toBe('NOT_ROOM_HOST');
    // The host still can.
    await request(app).post(`/v1/rooms/${room.id}/seats/${b.id}/mute`).set(auth(host)).send({ muted: true }).expect(200);

    await request(app).post(`/v1/rooms/${room.id}/admins`).set(auth(a)).send({ userId: host.id }).expect(403);
    await request(app).delete(`/v1/rooms/${room.id}/admins/${b.id}`).set(auth(a)).expect(403);
    const removed = await request(app).delete(`/v1/rooms/${room.id}/admins/${b.id}`).set(auth(host)).expect(200);
    expect(removed.body.admins).toEqual([a.id]);
  });

  it('refuses a guest, the host, and a sixth admin', async () => {
    const host = await adult('Host');
    const room = await goLive(host);
    const g = await guest();
    const asGuest = await request(app).post(`/v1/rooms/${room.id}/admins`).set(auth(host)).send({ userId: g.id }).expect(409);
    expect(asGuest.body.error.code).toBe('ADMIN_MUST_BE_REGISTERED');
    const self = await request(app).post(`/v1/rooms/${room.id}/admins`).set(auth(host)).send({ userId: host.id }).expect(409);
    expect(self.body.error.code).toBe('CANNOT_ADMIN_HOST');

    for (let i = 0; i < 5; i++) {
      const u = await adult(`Admin ${i}`);
      await request(app).post(`/v1/rooms/${room.id}/admins`).set(auth(host)).send({ userId: u.id }).expect(200);
    }
    const sixth = await adult('One too many');
    const full = await request(app).post(`/v1/rooms/${room.id}/admins`).set(auth(host)).send({ userId: sixth.id }).expect(409);
    expect(full.body.error.code).toBe('ROOM_ADMINS_FULL');
  });

  it('die with the room', async () => {
    const host = await adult('Host');
    const admin = await adult('Trusted');
    const room = await goLive(host);
    await request(app).post(`/v1/rooms/${room.id}/admins`).set(auth(host)).send({ userId: admin.id }).expect(200);
    await request(app).post(`/v1/rooms/${room.id}/end`).set(auth(host)).expect(200);
    const again = await request(app).post(`/v1/rooms/${room.id}/admins`).set(auth(host)).send({ userId: admin.id }).expect(410);
    expect(again.body.error.code).toBe('ROOM_ENDED');
  });
});

describe('host earnings', () => {
  it('read from the gifts already sent, by IST day, with the top gifters', async () => {
    const host = await adult('Host');
    const fan = await adult('Fan');
    const other = await adult('Other');
    const room = await goLive(host);
    await grantCoins(fan.id, 10_000);
    await grantCoins(other.id, 10_000);
    await request(app).post(`/v1/rooms/${room.id}/join`).set(auth(fan)).expect(200);
    await request(app).post(`/v1/rooms/${room.id}/join`).set(auth(other)).expect(200);

    const gift = (sender: User, giftId: string, price: number, quantity = 1) =>
      request(app)
        .post('/v1/gifts/send')
        .set(auth(sender))
        .set('Idempotency-Key', randomUUID())
        .send({ roomId: room.id, recipientId: host.id, giftId, quantity, expectedCoinPrice: price })
        .expect(200);
    await gift(fan, 'rose', 90, 10); // 900 coins
    await gift(other, 'heart', 20); // 20 coins

    const res = await request(app).get('/v1/gifts/earnings').set(auth(host)).expect(200);
    const e = res.body.earnings;
    expect(e.window).toMatchObject({ days: 30, coins: 920, gifts: 2, rooms: 1 });
    // 60% of the coin count, as points.
    expect(e.window.points).toBe(552);
    expect(e.pointsBalance).toBe(552);
    expect(e.daily).toHaveLength(30);
    expect(e.daily[29]).toMatchObject({ coins: 920, points: 552, gifts: 2 });
    expect(e.topGifters.map((g: { userId: string; coins: number }) => [g.userId, g.coins])).toEqual([
      [fan.id, 900],
      [other.id, 20],
    ]);
  });

  it('is a registered user’s own view and nobody else’s', async () => {
    const g = await guest();
    await request(app).get('/v1/gifts/earnings').set(auth(g)).expect(403);
    await request(app).get('/v1/gifts/earnings').expect(401);
  });
});

describe('the share page', () => {
  it('shows who is live, escaped, with a link that opens the app on the room code', async () => {
    const host = await adult('Priya <script>alert(1)</script>');
    const room = await goLive(host);
    await pool.query("UPDATE rooms SET title = $2 WHERE id = $1", [room.id, 'Sunday <b>songs</b>']);

    const res = await request(app).get(`/r/${room.publicId}`).expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Sunday &lt;b&gt;songs&lt;/b&gt;');
    expect(res.text).toContain('Priya &lt;script&gt;');
    expect(res.text).not.toContain('<script>');
    expect(res.text).toContain(`href="dhun://r/${room.publicId}"`);
    expect(res.text).toContain('play.google.com');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('answers an ended or unknown room with a page, not an error', async () => {
    const host = await adult('Host');
    const room = await goLive(host);
    await request(app).post(`/v1/rooms/${room.id}/end`).set(auth(host)).expect(200);
    const res = await request(app).get(`/r/${room.publicId}`).expect(404);
    expect(res.text).toContain('This room has ended');
    await request(app).get('/r/100000').expect(422);
  });

  it('tells the app where a shared link points', async () => {
    const res = await request(app).get('/v1/config/app').expect(200);
    expect(res.body.config.shareBaseUrl).toBe('https://dhun.live');
  });
});
