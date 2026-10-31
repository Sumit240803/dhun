// Phase 1, slice 1: private messages, friends, spend controls, trending,
// seasonal gifts.

import { randomUUID } from 'crypto';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { ECONOMY, freeCoinGrantLegs, invalidateCatalogCache, postTransaction } from '../src/modules/economy/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { rollupRoomHour } from '../src/modules/rooms/index.js';
import { closePool, resetLedger } from './helpers.js';

vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return { ...actual, publishToRoom: () => undefined, publishGlobal: () => undefined };
});

const app = buildApp();
let counter = 0;
const nextPhone = () => `+9187${String(30_000_000 + counter++).slice(-8)}`;

interface User {
  id: string;
  token: string;
}

async function adult(name = 'Asha'): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { deviceId: `p1-${randomUUID()}`, platform: 'android' } })
    .expect(200);
  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name })
    .expect(200);
  return { id: res.body.user.id as string, token };
}

const auth = (u: User) => ({ Authorization: `Bearer ${u.token}` });

async function grantCoins(userId: string, coins: number): Promise<void> {
  await postTransaction({
    txnType: 'free_coin_grant',
    idempotencyKey: uuidv7(),
    identity: { source: 'signup' },
    rates: { faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee, pointsPerRupee: ECONOMY.pointsPerRupee },
    legs: freeCoinGrantLegs({ userId, coins }),
  });
}

async function goLive(host: User): Promise<string> {
  const res = await request(app)
    .post('/v1/rooms/live')
    .set(auth(host))
    .send({ title: 'Evening adda', tag: 'chatting' })
    .expect(201);
  return res.body.room.id as string;
}

const gift = (sender: User, roomId: string, hostId: string, quantity = 1) =>
  request(app)
    .post('/v1/gifts/send')
    .set(auth(sender))
    .set('Idempotency-Key', randomUUID())
    .send({ roomId, recipientId: hostId, giftId: 'rose', quantity, expectedCoinPrice: 90 });

beforeEach(async () => {
  await resetLedger();
  invalidateCatalogCache();
  await pool.query('DELETE FROM spend_controls');
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'setParticipantGrants').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());
afterAll(closePool);

describe('private messages', () => {
  it('open one thread per pair, deliver, mark unread, and show in the list', async () => {
    const asha = await adult('Asha');
    const ravi = await adult('Ravi');

    const opened = await request(app).post(`/v1/messages/threads/with/${ravi.id}`).set(auth(asha)).expect(200);
    const again = await request(app).post(`/v1/messages/threads/with/${asha.id}`).set(auth(ravi)).expect(200);
    expect(again.body.thread.id).toBe(opened.body.thread.id);
    expect(opened.body.thread.title).toBe('Ravi');

    const sent = await request(app)
      .post(`/v1/messages/threads/${opened.body.thread.id}/messages`)
      .set(auth(asha))
      .send({ body: 'Namaste! Loved your room.' })
      .expect(201);
    expect(sent.body.message).toMatchObject({ body: 'Namaste! Loved your room.', mine: true });

    const theirs = await request(app).get('/v1/messages/threads?filter=unread').set(auth(ravi)).expect(200);
    expect(theirs.body.threads[0]).toMatchObject({ id: opened.body.thread.id, title: 'Asha', unread: 1 });
    const messages = await request(app)
      .get(`/v1/messages/threads/${opened.body.thread.id}/messages`)
      .set(auth(ravi))
      .expect(200);
    expect(messages.body.messages[0]).toMatchObject({ body: 'Namaste! Loved your room.', mine: false });
  });

  it('filters like room chat, refuses a reply to an official thread, and closes on a block', async () => {
    const asha = await adult('Asha');
    const ravi = await adult('Ravi');
    const thread = (await request(app).post(`/v1/messages/threads/with/${ravi.id}`).set(auth(asha)).expect(200)).body
      .thread.id as string;

    const blocked = await request(app)
      .post(`/v1/messages/threads/${thread}/messages`)
      .set(auth(asha))
      .send({ body: 'bhosdike, aa ja' })
      .expect(422);
    expect(blocked.body.error.code).toBe('MESSAGE_BLOCKED');

    await pool.query("INSERT INTO message_threads (id, kind, title) VALUES ($1, 'official', 'Dhun team')", [uuidv7()]);
    const { rows } = await pool.query("SELECT id FROM message_threads WHERE kind = 'official' LIMIT 1");
    await pool.query('INSERT INTO thread_participants (thread_id, user_id) VALUES ($1, $2)', [rows[0].id, asha.id]);
    const readOnly = await request(app)
      .post(`/v1/messages/threads/${rows[0].id}/messages`)
      .set(auth(asha))
      .send({ body: 'hello?' })
      .expect(409);
    expect(readOnly.body.error.code).toBe('THREAD_READ_ONLY');

    await request(app).post(`/v1/users/${asha.id}/block`).set(auth(ravi)).expect(200);
    await request(app).post(`/v1/messages/threads/${thread}/messages`).set(auth(asha)).send({ body: 'still there?' }).expect(404);
    await request(app).post(`/v1/messages/threads/with/${ravi.id}`).set(auth(asha)).expect(404);
  });
});

describe('friends', () => {
  it('are follows in both directions, live ones first', async () => {
    const me = await adult('Me');
    const mutual = await adult('Mutual');
    const oneWay = await adult('One way');
    await request(app).post(`/v1/users/${mutual.id}/follow`).set(auth(me)).expect(200);
    await request(app).post(`/v1/users/${me.id}/follow`).set(auth(mutual)).expect(200);
    await request(app).post(`/v1/users/${oneWay.id}/follow`).set(auth(me)).expect(200);
    const roomId = await goLive(mutual);

    const res = await request(app).get('/v1/users/me/friends').set(auth(me)).expect(200);
    expect(res.body.friends).toHaveLength(1);
    expect(res.body.friends[0]).toMatchObject({ userId: mutual.id, displayName: 'Mutual', liveRoomId: roomId });
  });
});

describe('spend controls', () => {
  it('stop a gift past the daily cap, and the cap lowers at once but raises after a day', async () => {
    const host = await adult('Host');
    const fan = await adult('Fan');
    const roomId = await goLive(host);
    await grantCoins(fan.id, 100_000);
    await request(app).post(`/v1/rooms/${roomId}/join`).set(auth(fan)).expect(200);

    await request(app)
      .put('/v1/users/me/spend-controls')
      .set(auth(fan))
      .send({ dailyCapCoins: 1000, monthlyCapCoins: null, exclusion: 'none' })
      .expect(200);

    await gift(fan, roomId, host.id, 10).expect(200); // 900
    const refused = await gift(fan, roomId, host.id, 10).expect(403); // would be 1800
    expect(refused.body.error).toMatchObject({ code: 'SPEND_LIMIT_REACHED', details: { period: 'day', capCoins: 1000, spentCoins: 900 } });
    await gift(fan, roomId, host.id, 1).expect(200); // 990

    // Raising waits; lowering does not.
    const raised = await request(app)
      .put('/v1/users/me/spend-controls')
      .set(auth(fan))
      .send({ dailyCapCoins: 5000, monthlyCapCoins: null, exclusion: 'none' })
      .expect(200);
    expect(raised.body.spend).toMatchObject({ dailyCapCoins: 1000, pending: { dailyCapCoins: 5000 } });
    await gift(fan, roomId, host.id, 1).expect(403);

    const lowered = await request(app)
      .put('/v1/users/me/spend-controls')
      .set(auth(fan))
      .send({ dailyCapCoins: 500, monthlyCapCoins: null, exclusion: 'none' })
      .expect(200);
    expect(lowered.body.spend).toMatchObject({ dailyCapCoins: 500, pending: null, todayCoins: 990 });

    // The delay passing applies the raise.
    await pool.query(
      `UPDATE spend_controls SET pending = jsonb_build_object('dailyCapCoins', 5000, 'appliesAt', (now() - interval '1 minute')) WHERE user_id = $1`,
      [fan.id],
    );
    const applied = await request(app).get('/v1/users/me/spend-controls').set(auth(fan)).expect(200);
    expect(applied.body.spend).toMatchObject({ dailyCapCoins: 5000, pending: null });
  });

  it('a pause blocks every gift and cannot be shortened while it runs', async () => {
    const host = await adult('Host');
    const fan = await adult('Fan');
    const roomId = await goLive(host);
    await grantCoins(fan.id, 10_000);
    await request(app).post(`/v1/rooms/${roomId}/join`).set(auth(fan)).expect(200);

    const paused = await request(app)
      .put('/v1/users/me/spend-controls')
      .set(auth(fan))
      .send({ dailyCapCoins: null, monthlyCapCoins: null, exclusion: '90d' })
      .expect(200);
    expect(paused.body.spend.excluded).toBe(true);

    const refused = await gift(fan, roomId, host.id).expect(403);
    expect(refused.body.error.code).toBe('SELF_EXCLUDED');

    const lift = await request(app)
      .put('/v1/users/me/spend-controls')
      .set(auth(fan))
      .send({ dailyCapCoins: null, monthlyCapCoins: null, exclusion: 'none' })
      .expect(409);
    expect(lift.body.error.code).toBe('EXCLUSION_ACTIVE');
    const shorten = await request(app)
      .put('/v1/users/me/spend-controls')
      .set(auth(fan))
      .send({ dailyCapCoins: null, monthlyCapCoins: null, exclusion: '30d' })
      .expect(409);
    expect(shorten.body.error.code).toBe('EXCLUSION_ACTIVE');
  });

  it('raises the cooling-off flag past the monthly line', async () => {
    const host = await adult('Host');
    const whale = await adult('Whale');
    const roomId = await goLive(host);
    await grantCoins(whale.id, 10_000_000);
    await request(app).post(`/v1/rooms/${roomId}/join`).set(auth(whale)).expect(200);
    // The line is ₹50,000 × 110 coins = 5,500,000 coins. Galaxy is 1,650,000.
    for (let i = 0; i < 4; i++) {
      await request(app)
        .post('/v1/gifts/send')
        .set(auth(whale))
        .set('Idempotency-Key', randomUUID())
        .send({ roomId, recipientId: host.id, giftId: 'galaxy', quantity: 1, expectedCoinPrice: 1_650_000 })
        .expect(200);
    }
    const res = await request(app).get('/v1/users/me/spend-controls').set(auth(whale)).expect(200);
    expect(res.body.spend).toMatchObject({ coolingOff: true, monthCoins: 6_600_000, coolingOffAtCoins: 5_500_000 });
  });
});

describe('trending', () => {
  it('lists the rooms earning this hour, in board order, and nothing else', async () => {
    const quiet = await adult('Quiet');
    const hot = await adult('Hot');
    const fan = await adult('Fan');
    await goLive(quiet);
    const hotRoom = await goLive(hot);
    await grantCoins(fan.id, 10_000);
    await request(app).post(`/v1/rooms/${hotRoom}/join`).set(auth(fan)).expect(200);
    await gift(fan, hotRoom, hot.id, 10).expect(200);
    await rollupRoomHour();

    const res = await request(app).get('/v1/rooms/feed?category=trending').expect(200);
    expect(res.body.rooms.map((r: { id: string }) => r.id)).toEqual([hotRoom]);
  });
});

describe('seasonal gifts', () => {
  it('leave the tray outside their window and come back inside it', async () => {
    const { rows } = await pool.query("SELECT visible_from, visible_to FROM gift_catalog WHERE id = 'rose'");
    try {
      await pool.query(
        "UPDATE gift_catalog SET visible_from = now() + interval '1 day', visible_to = now() + interval '2 days' WHERE id = 'rose'",
      );
      invalidateCatalogCache();
      const hidden = await request(app).get('/v1/catalog/gifts').expect(200);
      expect(hidden.body.gifts.some((g: { id: string }) => g.id === 'rose')).toBe(false);

      await pool.query(
        "UPDATE gift_catalog SET visible_from = now() - interval '1 day', visible_to = now() + interval '1 day' WHERE id = 'rose'",
      );
      invalidateCatalogCache();
      const shown = await request(app).get('/v1/catalog/gifts').expect(200);
      expect(shown.body.gifts.some((g: { id: string }) => g.id === 'rose')).toBe(true);
    } finally {
      await pool.query("UPDATE gift_catalog SET visible_from = $1, visible_to = $2 WHERE id = 'rose'", [
        rows[0].visible_from,
        rows[0].visible_to,
      ]);
      invalidateCatalogCache();
    }
  });
});
