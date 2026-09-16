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
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import {
  countLivePlaceholderAssets,
  runReconciliation,
} from '../src/workers/jobs/reconciliation.js';
import {
  balanceDrift,
  closePool,
  resetLedger,
  setTxnTypeActive,
  sumEntries,
  unbalancedTxns,
} from './helpers.js';

// The fast path is asserted on, not exercised: the room bus is Redis, and what
// matters here is that a committed gift is announced exactly once, in the shape
// the gateway relays.
const published = vi.hoisted(() => [] as Array<{ roomId: string; message: unknown }>);
vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return {
    ...actual,
    publishToRoom: (roomId: string, message: unknown) => {
      published.push({ roomId, message });
    },
  };
});

const app = buildApp();
const DEVICE = { deviceId: 'gift-device-0001', platform: 'android' };

let phoneCounter = 0;
const nextPhone = () => `+9196${String(30_000_000 + phoneCounter++).slice(-8)}`;

interface User {
  id: string;
  token: string;
}

/** Registered, phone-verified and 18+ — everything a money endpoint demands. */
async function adult(name = 'Asha'): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { ...DEVICE, deviceId: `gd-${phone}` } })
    .expect(200);

  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name })
    .expect(200);

  return { id: res.body.user.id as string, token };
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

async function goLive(host: User, seatCapacity?: number): Promise<string> {
  const res = await request(app)
    .post('/v1/rooms/live')
    .set('Authorization', `Bearer ${host.token}`)
    .send({ title: 'Evening adda', tag: 'chatting', ...(seatCapacity ? { seatCapacity } : {}) })
    .expect(201);
  return res.body.room.id as string;
}

function send(
  sender: User,
  body: {
    roomId: string;
    recipientId: string;
    giftId?: string;
    quantity?: number;
    expectedCoinPrice?: number;
  },
  key: string = randomUUID(),
) {
  return request(app)
    .post('/v1/gifts/send')
    .set('Authorization', `Bearer ${sender.token}`)
    .set('Idempotency-Key', key)
    .send({
      giftId: 'rose',
      quantity: 1,
      expectedCoinPrice: 45,
      ...body,
    });
}

async function giftRows(roomId: string) {
  const { rows } = await pool.query(
    'SELECT sender_user_id, recipient_user_id, gift_id, quantity, unit_price, coins, points' +
      ' FROM gift_sends WHERE room_id = $1 ORDER BY created_at',
    [roomId],
  );
  return rows;
}

/** A room with a host, and a sender holding `coins`. */
async function scene(coins = 10_000) {
  const host = await adult('Host');
  const sender = await adult('Asha');
  const roomId = await goLive(host);
  await grantCoins(sender.id, coins);
  return { host, sender, roomId };
}

beforeEach(async () => {
  await resetLedger();
  invalidateCatalogCache();
  published.length = 0;
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await setTxnTypeActive('gift_send', true);
});

afterAll(closePool);

describe('sending a gift', () => {
  it('moves the money, pays the host 60% of the coins as points, and records it', async () => {
    const { host, sender, roomId } = await scene();

    const res = await send(sender, {
      roomId,
      recipientId: host.id,
      giftId: 'scooter',
      expectedCoinPrice: 3_300,
    }).expect(200);

    expect(res.body.coinsSpent).toBe(3_300);
    expect(res.body.balance.coins).toBe(10_000 - 3_300);
    expect(res.body.replayed).toBe(false);

    // points = coins × payout_rate. No ×2 — that is what makes 60% really 30%.
    expect(await sumEntries('host_points_held', host.id)).toBe(Math.floor(3_300 * 0.6));
    expect(await sumEntries('user_coins', sender.id)).toBe(6_700);

    expect(await giftRows(roomId)).toEqual([
      {
        sender_user_id: sender.id,
        recipient_user_id: host.id,
        gift_id: 'scooter',
        quantity: 1,
        unit_price: '3300',
        coins: '3300',
        points: '1980',
      },
    ]);

    expect(await unbalancedTxns()).toEqual([]);
    expect(await balanceDrift()).toEqual([]);
  });

  it('announces it to the room, once, in the shape the strips and animations draw', async () => {
    const { host, sender, roomId } = await scene(20_000);

    const res = await send(sender, {
      roomId,
      recipientId: host.id,
      giftId: 'yacht',
      expectedCoinPrice: 15_500,
    }).expect(200);

    expect(published).toHaveLength(1);
    expect(published[0]).toEqual({
      roomId,
      message: { t: 'gift', roomId, gift: res.body.gift },
    });

    // Every field GiftView in gateway/protocol.ts declares. The API mirrors it
    // rather than importing it, so this is what holds the two together.
    expect(res.body.gift).toEqual({
      id: expect.any(String),
      senderId: sender.id,
      senderName: 'Asha',
      senderAvatar: null,
      senderFrame: null,
      recipientId: host.id,
      recipientName: 'Host',
      giftId: 'yacht',
      giftName: 'Yacht',
      giftIcon: 'placeholder/gifts/yacht/icon.v1.webp',
      tier: 3,
      effect: 'fullscreen',
      animationAsset: 'placeholder/gifts/yacht/anim.v1.json',
      coinPrice: 15_500,
      quantity: 1,
    });

    // The gift's id IS the ledger transaction — clients dedupe on it.
    const txn = await pool.query("SELECT 1 FROM ledger_txns WHERE id = $1 AND txn_type = 'gift_send'", [
      res.body.gift.id,
    ]);
    expect(txn.rowCount).toBe(1);
  });

  it('sends a combo as ONE transaction with a quantity', async () => {
    const { host, sender, roomId } = await scene(10_000);

    const res = await send(sender, { roomId, recipientId: host.id, quantity: 99 }).expect(200);

    expect(res.body.coinsSpent).toBe(45 * 99);
    const txns = await pool.query("SELECT count(*) FROM ledger_txns WHERE txn_type = 'gift_send'");
    expect(Number(txns.rows[0].count)).toBe(1);
    expect(await sumEntries('host_points_held', host.id)).toBe(Math.floor(45 * 99 * 0.6));
  });

  it('can go to someone on a seat in a party room', async () => {
    const host = await adult('Host');
    const guest = await adult('Rohan');
    const sender = await adult('Asha');
    const roomId = await goLive(host, 4);
    await pool.query('INSERT INTO room_seats (room_id, seat_index, user_id) VALUES ($1, 1, $2)', [
      roomId,
      guest.id,
    ]);
    await grantCoins(sender.id, 1_000);

    const res = await send(sender, { roomId, recipientId: guest.id }).expect(200);

    expect(res.body.gift.recipientName).toBe('Rohan');
    expect(await sumEntries('host_points_held', guest.id)).toBe(27);
    expect(await sumEntries('host_points_held', host.id)).toBe(0);
  });
});

describe('retries', () => {
  it('replays the same gift for the same key, and charges once', async () => {
    const { host, sender, roomId } = await scene(1_000);
    const key = randomUUID();

    const first = await send(sender, { roomId, recipientId: host.id }, key).expect(200);
    const second = await send(sender, { roomId, recipientId: host.id }, key).expect(200);

    expect(second.body.replayed).toBe(true);
    expect(second.body.gift.id).toBe(first.body.gift.id);
    expect(second.body.balance.coins).toBe(955);
    expect(await sumEntries('user_coins', sender.id)).toBe(955);
    // Announced once. A replay already had its moment on screen.
    expect(published).toHaveLength(1);
    expect(await giftRows(roomId)).toHaveLength(1);
  });

  it('replays a gift whose room ended before the retry arrived', async () => {
    // The response was lost, the host ended the room, the phone retried. The
    // sender must hear "sent" — because it was — not "room ended".
    const { host, sender, roomId } = await scene(1_000);
    const key = randomUUID();

    const first = await send(sender, { roomId, recipientId: host.id }, key).expect(200);
    await request(app)
      .post(`/v1/rooms/${roomId}/end`)
      .set('Authorization', `Bearer ${host.token}`)
      .expect(200);

    const retry = await send(sender, { roomId, recipientId: host.id }, key).expect(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.gift.id).toBe(first.body.gift.id);
  });

  it('refuses a key reused for a different gift', async () => {
    const { host, sender, roomId } = await scene(10_000);
    const key = randomUUID();

    await send(sender, { roomId, recipientId: host.id }, key).expect(200);
    const res = await send(sender, { roomId, recipientId: host.id, quantity: 10 }, key).expect(422);

    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('never overspends under a burst of parallel taps', async () => {
    // Twelve 1,000-coin sends against a balance that covers five.
    const { host, sender, roomId } = await scene(5_000);
    await pool.query("UPDATE gift_catalog SET coin_price = 1000 WHERE id = 'teddy'");

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        send(sender, {
          roomId,
          recipientId: host.id,
          giftId: 'teddy',
          expectedCoinPrice: 1_000,
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 200).length;
    expect(ok).toBe(5);
    expect(results.filter((r) => r.status === 402)).toHaveLength(7);
    expect(await sumEntries('user_coins', sender.id)).toBe(0);
    // No gift record without its money, and no money without its record.
    expect(await giftRows(roomId)).toHaveLength(5);
    expect(await balanceDrift()).toEqual([]);

    await pool.query("UPDATE gift_catalog SET coin_price = 999 WHERE id = 'teddy'");
  });
});

describe('refusals', () => {
  it('refuses a gift the sender cannot afford, and writes nothing', async () => {
    const { host, sender, roomId } = await scene(100);

    const res = await send(sender, {
      roomId,
      recipientId: host.id,
      giftId: 'scooter',
      expectedCoinPrice: 3_300,
    }).expect(402);

    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await giftRows(roomId)).toEqual([]);
    expect(published).toEqual([]);
  });

  it('refuses a gift to yourself', async () => {
    // The cash-out half of card fraud: stolen card → coins → gift to self → payout.
    const host = await adult('Host');
    const roomId = await goLive(host);
    await grantCoins(host.id, 1_000);

    const res = await send(host, { roomId, recipientId: host.id }).expect(422);
    expect(res.body.error.code).toBe('GIFT_TO_SELF');
  });

  it('refuses a recipient who is not on stage', async () => {
    const { sender, roomId } = await scene();
    const bystander = await adult('Meera');

    const res = await send(sender, { roomId, recipientId: bystander.id }).expect(409);
    expect(res.body.error.code).toBe('RECIPIENT_NOT_IN_ROOM');
  });

  it('refuses a recipient who blocked the sender — without saying so', async () => {
    const { host, sender, roomId } = await scene();
    await pool.query('INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)', [
      host.id,
      sender.id,
    ]);

    const res = await send(sender, { roomId, recipientId: host.id }).expect(409);
    // Indistinguishable from "not in the room", so a block cannot be probed.
    expect(res.body.error.code).toBe('RECIPIENT_NOT_IN_ROOM');
  });

  it('refuses a room that has ended', async () => {
    const { host, sender, roomId } = await scene();
    await request(app)
      .post(`/v1/rooms/${roomId}/end`)
      .set('Authorization', `Bearer ${host.token}`)
      .expect(200);

    const res = await send(sender, { roomId, recipientId: host.id }).expect(410);
    expect(res.body.error.code).toBe('ROOM_ENDED');
  });

  it('refuses a sender the host removed from the room', async () => {
    const { host, sender, roomId } = await scene();
    await pool.query('INSERT INTO room_bans (room_id, user_id, banned_by) VALUES ($1, $2, $3)', [
      roomId,
      sender.id,
      host.id,
    ]);

    const res = await send(sender, { roomId, recipientId: host.id }).expect(403);
    expect(res.body.error.code).toBe('ROOM_BANNED');
  });

  it('refuses to charge a price the user never saw', async () => {
    const { host, sender, roomId } = await scene();

    const res = await send(sender, {
      roomId,
      recipientId: host.id,
      expectedCoinPrice: 40,
    }).expect(409);

    expect(res.body.error.code).toBe('GIFT_PRICE_CHANGED');
    expect(res.body.error.details).toEqual({ coinPrice: 45 });
    expect(await sumEntries('user_coins', sender.id)).toBe(10_000);
  });

  it('refuses a gift that is no longer sold', async () => {
    const { host, sender, roomId } = await scene();
    await pool.query("UPDATE gift_catalog SET is_active = false WHERE id = 'rose'");

    try {
      const res = await send(sender, { roomId, recipientId: host.id }).expect(404);
      expect(res.body.error.code).toBe('GIFT_NOT_FOUND');
    } finally {
      await pool.query("UPDATE gift_catalog SET is_active = true WHERE id = 'rose'");
    }
  });

  it('refuses any quantity that is not a combo multiplier', async () => {
    const { host, sender, roomId } = await scene();

    const res = await send(sender, { roomId, recipientId: host.id, quantity: 7 }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('refuses unknown fields rather than ignoring them', async () => {
    const { host, sender, roomId } = await scene();

    const res = await request(app)
      .post('/v1/gifts/send')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomId,
        recipientId: host.id,
        giftId: 'rose',
        quantity: 1,
        expectedCoinPrice: 45,
        coins: 1,
      })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('requires an Idempotency-Key', async () => {
    const { host, sender, roomId } = await scene();

    const res = await request(app)
      .post('/v1/gifts/send')
      .set('Authorization', `Bearer ${sender.token}`)
      .send({ roomId, recipientId: host.id, giftId: 'rose', quantity: 1, expectedCoinPrice: 45 })
      .expect(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('refuses a guest — guests may watch and never spend', async () => {
    const host = await adult('Host');
    const roomId = await goLive(host);
    const guest = await request(app)
      .post('/v1/auth/guest')
      .send({ device: { ...DEVICE, deviceId: `guest-${Date.now()}` } })
      .expect(201);

    const res = await send(
      { id: guest.body.user.id, token: guest.body.accessToken },
      { roomId, recipientId: host.id },
    ).expect(403);
    expect(res.body.error.code).toBe('REGISTRATION_REQUIRED');
  });

  it('stops at the kill switch with no money moved', async () => {
    const { host, sender, roomId } = await scene(1_000);
    await setTxnTypeActive('gift_send', false);

    const res = await send(sender, { roomId, recipientId: host.id }).expect(503);

    expect(res.body.error.code).toBe('TXN_TYPE_INACTIVE');
    expect(await sumEntries('user_coins', sender.id)).toBe(1_000);
    expect(await giftRows(roomId)).toEqual([]);
  });
});

describe('the room leaderboard', () => {
  it('ranks senders by total coins given in the room', async () => {
    const { host, sender, roomId } = await scene(20_000);
    const whale = await adult('Kabir');
    await grantCoins(whale.id, 20_000);

    await send(sender, { roomId, recipientId: host.id, quantity: 10 }).expect(200); // 450
    await send(sender, { roomId, recipientId: host.id }).expect(200); // 45
    await send(whale, {
      roomId,
      recipientId: host.id,
      giftId: 'scooter',
      expectedCoinPrice: 3_300,
    }).expect(200);

    // Readable without a session, like the room itself.
    const res = await request(app).get(`/v1/gifts/leaderboard/${roomId}`).expect(200);

    expect(res.body.leaderboard).toEqual([
      { rank: 1, userId: whale.id, displayName: 'Kabir', avatarUrl: null, coins: 3_300 },
      { rank: 2, userId: sender.id, displayName: 'Asha', avatarUrl: null, coins: 495 },
    ]);
  });

  it('is empty for a room with no gifts, and a 404 for no room at all', async () => {
    const host = await adult('Host');
    const roomId = await goLive(host);

    const empty = await request(app).get(`/v1/gifts/leaderboard/${roomId}`).expect(200);
    expect(empty.body.leaderboard).toEqual([]);

    const missing = await request(app).get(`/v1/gifts/leaderboard/${randomUUID()}`).expect(404);
    expect(missing.body.error.code).toBe('ROOM_NOT_FOUND');
  });
});

describe('the catalog on the asset contract', () => {
  it('gives every gift an icon, and an animation only to full-screen gifts', async () => {
    const res = await request(app).get('/v1/catalog/gifts').expect(200);
    const gifts = res.body.gifts as Array<{
      id: string;
      effect: string;
      iconAsset: string | null;
      animationAsset: string | null;
    }>;

    expect(gifts).toHaveLength(20);
    for (const gift of gifts) {
      expect(gift.iconAsset).toBe(`placeholder/gifts/${gift.id}/icon.v1.webp`);
      expect(gift.animationAsset).toBe(
        gift.effect === 'basic' ? null : `placeholder/gifts/${gift.id}/anim.v1.json`,
      );
    }
  });
});

describe('reconciliation', () => {
  it('finds every gift recorded and in agreement with the ledger', async () => {
    const { host, sender, roomId } = await scene(10_000);
    await send(sender, { roomId, recipientId: host.id, quantity: 10 }).expect(200);

    const outcomes = await runReconciliation();
    expect(outcomes.find((o) => o.name === 'gift_sends_match_ledger')?.status).toBe('pass');
    // Stand-in art is expected outside production, so the guard stands down.
    expect(outcomes.find((o) => o.name === 'no_placeholder_assets_live')?.status).toBe('skipped');
  });

  it('catches a gift transaction with no gift record', async () => {
    const host = await adult('Host');
    const sender = await adult('Asha');
    await grantCoins(sender.id, 1_000);

    // A write path that moved the money but skipped the record — exactly what
    // writing both in one transaction exists to prevent.
    const { giftLegs } = await import('../src/modules/economy/index.js');
    await postTransaction({
      txnType: 'gift_send',
      idempotencyKey: uuidv7(),
      identity: { gift_id: 'rose', recipient_id: host.id, quantity: 1 },
      rates: {
        faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
        pointsPerRupee: ECONOMY.pointsPerRupee,
        payoutRateBp: 6_000,
      },
      legs: giftLegs({ userId: sender.id, hostId: host.id, coins: 45, payoutRateBp: 6_000 }),
    });

    const outcomes = await runReconciliation();
    const check = outcomes.find((o) => o.name === 'gift_sends_match_ledger');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toEqual({ missing: 1, mismatched: 0 });
  });

  it('counts the seeded placeholder art the production guard would refuse', async () => {
    const client = await pool.connect();
    try {
      // Rows, not files: all 20 gifts are on stand-in art until real art lands.
      expect(await countLivePlaceholderAssets(client)).toBe(20);
    } finally {
      client.release();
    }
  });
});
