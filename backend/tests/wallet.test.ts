import { createHmac, randomUUID } from 'crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { invalidateCatalogCache } from '../src/modules/economy/index.js';
import { closePool, resetLedger, systemBalance } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'wallet-device-0001', platform: 'android' };

let phoneCounter = 0;
const nextPhone = () => `+9197${String(20_000_000 + phoneCounter++).slice(-8)}`;

/**
 * A signed-in, registered ADULT.
 *
 * Money endpoints require all three: authenticated, phone-verified, and over 18.
 * The date of birth is set here because without it every purchase is refused
 * with DOB_REQUIRED — which is hard rule #5 being enforced where it matters
 * rather than left as an optional profile field.
 */
async function registeredUser() {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { ...DEVICE, deviceId: `wd-${phone}` } })
    .expect(200);

  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15' })
    .expect(200);

  return { id: res.body.user.id as string, token };
}

const stubToken = () => `stub-${randomUUID()}`;

function buyIap(token: string, packId: string, opts: { purchaseToken?: string; key?: string } = {}) {
  return request(app)
    .post('/v1/wallet/purchase/iap')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', opts.key ?? randomUUID())
    .send({ packId, purchaseToken: opts.purchaseToken ?? stubToken() });
}

/** Razorpay signs `order_id|payment_id` with the account key secret. */
function razorpaySignature(orderId: string, paymentId: string) {
  return createHmac('sha256', process.env.RAZORPAY_KEY_SECRET ?? 'razorpay-test-secret')
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

beforeEach(async () => {
  await resetLedger();
  invalidateCatalogCache();
});
afterAll(closePool);

describe('server-driven catalog', () => {
  it('serves coin packs with the coin/gem split', async () => {
    const res = await request(app).get('/v1/wallet/packs').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');

    const user = await registeredUser();
    const packs = await request(app)
      .get('/v1/wallet/packs')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(packs.body.packs).toHaveLength(6);
    const popular = packs.body.packs.find((p: { id: string }) => p.id === 'popular_299');
    expect(popular).toMatchObject({
      pricePaise: 29_900,
      coins: 16_445,
      gems: 5_355,
      badge: 'Most Popular',
    });
  });

  it('serves the repriced gift catalog without auth', async () => {
    const res = await request(app).get('/v1/catalog/gifts').expect(200);
    const byId = Object.fromEntries(res.body.gifts.map((g: { id: string }) => [g.id, g]));

    expect(res.body.gifts).toHaveLength(20);
    expect(byId.yacht.coinPrice).toBe(15_500);
    expect(byId.scooter).toMatchObject({ coinPrice: 3_300, tier: 3, effect: 'fullscreen' });
    // payout_rate is per gift, never a global constant.
    expect(byId.rose.payoutRateBp).toBe(6_000);
  });

  it('hides Phase 1 cosmetics that are seeded inactive', async () => {
    const res = await request(app).get('/v1/catalog/cosmetics').expect(200);
    const ids = res.body.cosmetics.map((c: { id: string }) => c.id);

    expect(ids).toContain('frame_basic');
    expect(ids).not.toContain('vip_gold'); // VIP is Phase 1
  });
});

describe('in-app purchase', () => {
  it('credits coins and gems separately, and levels the user up', async () => {
    const user = await registeredUser();
    const res = await buyIap(user.token, 'popular_299').expect(200);

    expect(res.body).toMatchObject({ coinsGranted: 16_445, gemsGranted: 5_355 });
    expect(res.body.balances).toEqual({ coins: 16_445, gems: 5_355 });
    // 16,445 purchased coins crosses the level-16 threshold (65,000)? No — level 6 (6,500).
    expect(res.body.userLevel).toBe(6);

    const wallet = await request(app)
      .get('/v1/wallet')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(wallet.body.wallet.lifetimePurchasedCoins).toBe(16_445);
  });

  it('books the pack discount so every unit stays worth 1/65 of a rupee', async () => {
    const user = await registeredUser();
    await buyIap(user.token, 'popular_299').expect(200);

    // 21,800 units of face value at 65/₹ = ₹335.38, sold for ₹299.
    expect(await systemBalance('deferred_revenue')).toBe(-33_538);
    expect(await systemBalance('cash_iap')).toBe(29_900);
    expect(await systemBalance('discount_pack')).toBe(3_638);
  });

  it('returns the original result when the client retries the same key', async () => {
    const user = await registeredUser();
    const key = randomUUID();
    const token = stubToken();

    const first = await buyIap(user.token, 'small_99', { purchaseToken: token, key }).expect(200);
    const second = await buyIap(user.token, 'small_99', { purchaseToken: token, key }).expect(200);

    expect(second.body.txnId).toBe(first.body.txnId);
    expect(second.body.replayed).toBe(true);
    expect(second.body.balances.coins).toBe(5_445); // credited once
  });

  it('rejects a replayed receipt sent with a fresh idempotency key', async () => {
    const user = await registeredUser();
    const token = stubToken();

    await buyIap(user.token, 'small_99', { purchaseToken: token }).expect(200);

    // A fresh key defeats the header guard, so the receipt itself has to be the
    // ledger's idempotency identity. Coins are credited exactly once.
    const replay = await buyIap(user.token, 'small_99', { purchaseToken: token }).expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.balances.coins).toBe(5_445);
  });

  it('refuses a receipt already redeemed by someone else', async () => {
    const a = await registeredUser();
    const b = await registeredUser();
    const token = stubToken();

    await buyIap(a.token, 'small_99', { purchaseToken: token }).expect(200);
    const res = await buyIap(b.token, 'small_99', { purchaseToken: token }).expect(409);

    expect(res.body.error.code).toBe('RECEIPT_ALREADY_USED');
  });

  it('rejects a malformed receipt', async () => {
    const user = await registeredUser();
    const res = await buyIap(user.token, 'small_99', { purchaseToken: 'totally-made-up' }).expect(402);
    expect(res.body.error.code).toBe('RECEIPT_INVALID');
  });

  it('allows the starter pack only once per lifetime', async () => {
    const user = await registeredUser();
    await buyIap(user.token, 'starter_19').expect(200);

    const second = await buyIap(user.token, 'starter_19').expect(409);
    expect(second.body.error.code).toBe('PACK_ALREADY_PURCHASED');
  });

  it('requires an Idempotency-Key', async () => {
    const user = await registeredUser();
    const res = await request(app)
      .post('/v1/wallet/purchase/iap')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ packId: 'small_99', purchaseToken: stubToken() })
      .expect(400);

    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects an Idempotency-Key that is not a UUID', async () => {
    const user = await registeredUser();
    const res = await request(app)
      .post('/v1/wallet/purchase/iap')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ packId: 'small_99', purchaseToken: stubToken() })
      .expect(400);

    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('blocks guests from spending', async () => {
    const guest = await request(app).post('/v1/auth/guest').send({ device: DEVICE }).expect(201);
    const res = await buyIap(guest.body.accessToken, 'small_99').expect(403);
    expect(res.body.error.code).toBe('REGISTRATION_REQUIRED');
  });

  it('rejects an unknown pack', async () => {
    const user = await registeredUser();
    const res = await buyIap(user.token, 'no_such_pack').expect(404);
    expect(res.body.error.code).toBe('PACK_NOT_FOUND');
  });
});

describe('web purchase (Razorpay)', () => {
  it('credits a correctly signed payment', async () => {
    const user = await registeredUser();
    const orderId = `order_${randomUUID().slice(0, 12)}`;
    const paymentId = `pay_${randomUUID().slice(0, 12)}`;

    const res = await request(app)
      .post('/v1/wallet/purchase/web')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        packId: 'value_999',
        orderId,
        paymentId,
        signature: razorpaySignature(orderId, paymentId),
      })
      .expect(200);

    expect(res.body.balances).toEqual({ coins: 54_945, gems: 23_055 });
    // The web channel has its own cash account, so channel mix is a balance read.
    expect(await systemBalance('cash_web')).toBe(99_900);
    expect(await systemBalance('cash_iap')).toBe(0);
  });

  it('rejects a forged signature', async () => {
    const user = await registeredUser();
    const res = await request(app)
      .post('/v1/wallet/purchase/web')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        packId: 'value_999',
        orderId: 'order_fake123456',
        paymentId: 'pay_fake123456',
        signature: 'f'.repeat(64),
      })
      .expect(402);

    expect(res.body.error.code).toBe('SIGNATURE_INVALID');
  });
});

describe('coins to gems conversion', () => {
  it('converts one way at +20%', async () => {
    const user = await registeredUser();
    await buyIap(user.token, 'popular_299').expect(200);

    const res = await request(app)
      .post('/v1/wallet/convert')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ coins: 6_500 })
      .expect(200);

    expect(res.body.gemsReceived).toBe(7_800);
    expect(res.body.wallet.coins).toBe(16_445 - 6_500);
    expect(res.body.wallet.gems).toBe(5_355 + 7_800);
    // The bonus mints units nobody paid for, booked as contra-revenue.
    expect(await systemBalance('discount_conversion_bonus')).toBe(2_000);
  });

  it('refuses to convert more coins than are held', async () => {
    const user = await registeredUser();
    await buyIap(user.token, 'small_99').expect(200);

    const res = await request(app)
      .post('/v1/wallet/convert')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ coins: 999_999 })
      .expect(402);

    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('enforces the minimum conversion size', async () => {
    const user = await registeredUser();
    await buyIap(user.token, 'small_99').expect(200);

    const res = await request(app)
      .post('/v1/wallet/convert')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ coins: 10 })
      .expect(422);

    expect(res.body.error.code).toBe('CONVERSION_TOO_SMALL');
  });

  it('has no reverse — gems can never become coins', async () => {
    // Guarded structurally rather than by a check: no endpoint, no leg builder,
    // and no transaction type exists for it. If one is ever added, the payout
    // design collapses — a whale would turn cosmetics money into giftable coins.
    const user = await registeredUser();
    await request(app)
      .post('/v1/wallet/convert-back')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ gems: 100 })
      .expect(404);
  });
});

describe('wallet history', () => {
  it('shows a user only their own movements', async () => {
    const user = await registeredUser();
    const other = await registeredUser();
    await buyIap(user.token, 'small_99').expect(200);
    await buyIap(other.token, 'value_999').expect(200);

    const res = await request(app)
      .get('/v1/wallet/transactions')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0]).toMatchObject({ type: 'purchase_iap', coins: 5_445 });
  });

  it('lists purchases with their status', async () => {
    const user = await registeredUser();
    await buyIap(user.token, 'big_2999').expect(200);

    const res = await request(app)
      .get('/v1/wallet/purchases')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(res.body.purchases[0]).toMatchObject({
      packId: 'big_2999',
      status: 'credited',
      amountPaise: 299_900,
    });
  });
});
