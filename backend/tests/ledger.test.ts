import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import {
  conversionLegs,
  cosmeticPurchaseLegs,
  freeCoinGrantLegs,
  giftLegs,
  postTransaction,
  purchaseLegs,
  getBalance,
  ECONOMY,
} from '../src/modules/economy/index.js';
import {
  balanceDrift,
  closePool,
  createUser,
  resetLedger,
  sumEntries,
  setTxnTypeActive,
  systemBalance,
  unbalancedTxns,
} from './helpers.js';

const RATES = {
  faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
  pointsPerRupee: ECONOMY.pointsPerRupee,
  payoutRateBp: ECONOMY.defaultGiftPayoutRateBp,
};

/** The packs, exactly as decided at 55 coins/₹. */
const POPULAR_PACK = { coins: 16_445, gems: 5_355, cashPaise: 29_900 } as const; // ₹299
const VALUE_PACK = { coins: 54_945, gems: 23_055, cashPaise: 99_900 } as const; // ₹999

function buyPack(pack: { coins: number; gems: number; cashPaise: number }, packId: string) {
  return (userId: string) =>
    postTransaction({
      txnType: 'purchase_web',
      idempotencyKey: uuidv7(),
      identity: { pack_id: packId },
      rates: RATES,
      legs: purchaseLegs({ userId, ...pack, channel: 'web' }),
    });
}

const buyPopularPack = buyPack(POPULAR_PACK, 'popular_299');

// Used wherever a Yacht (19,500 coins) is sent. At 55 coins/₹ the ₹299 pack
// yields only 16,445 coins, so it no longer covers the top Tier 3 gift.
const buyValuePack = buyPack(VALUE_PACK, 'value_999');

beforeEach(resetLedger);
afterAll(closePool);

describe('invariants', () => {
  it('every transaction sums to zero in every unit it touches', async () => {
    const user = await createUser();
    const host = await createUser();

    await buyValuePack(user);
    await postTransaction({
      txnType: 'free_coin_grant',
      idempotencyKey: uuidv7(),
      identity: { source: 'signup' },
      rates: RATES,
      legs: freeCoinGrantLegs({ userId: user, coins: 500 }),
    });
    // Deliberately awkward amounts: these are where floor() rounding bites.
    for (const coins of [10, 99, 199, 2_600, 4_900, 19_500]) {
      await postTransaction({
        txnType: 'gift_send',
        idempotencyKey: uuidv7(),
        identity: { gift_id: 'g' + coins, host_id: host, quantity: 1 },
        rates: RATES,
        legs: giftLegs({ userId: user, hostId: host, coins, payoutRateBp: 6_000 }),
      });
    }
    await postTransaction({
      txnType: 'coin_to_gem_conversion',
      idempotencyKey: uuidv7(),
      identity: { coin_amount: 6_500 },
      rates: RATES,
      legs: conversionLegs({ userId: user, coins: 6_500 }),
    });
    await postTransaction({
      txnType: 'cosmetic_purchase',
      idempotencyKey: uuidv7(),
      identity: { item_id: 'frame_basic', duration_days: 30 },
      rates: RATES,
      legs: cosmeticPurchaseLegs({ userId: user, gems: 3_250 }),
    });

    expect(await unbalancedTxns()).toEqual([]);
  });

  it('rejects unbalanced legs before touching the database', async () => {
    const user = await createUser();
    await expect(
      postTransaction({
        txnType: 'free_coin_grant',
        idempotencyKey: uuidv7(),
        identity: {},
        rates: RATES,
        legs: [{ accountCode: 'user_coins', scopeId: user, unit: 'coin', amount: 100 }],
      }),
    ).rejects.toThrow(/sum to 100/);
  });

  it('keeps the cached balance equal to the sum of entries', async () => {
    const user = await createUser();
    const host = await createUser();
    await buyValuePack(user);
    await postTransaction({
      txnType: 'gift_send',
      idempotencyKey: uuidv7(),
      identity: { gift_id: 'yacht', host_id: host, quantity: 1 },
      rates: RATES,
      legs: giftLegs({ userId: user, hostId: host, coins: 19_500, payoutRateBp: 6_000 }),
    });

    expect(await balanceDrift()).toEqual([]);
    expect(await getBalance('user_coins', user)).toBe(await sumEntries('user_coins', user));
  });

  it('mirrors every user balance in the system float', async () => {
    const user = await createUser();
    await buyPopularPack(user);
    // Coin float is the counterparty to every coin and gem in circulation, so
    // reconciliation check E3 is structural rather than something that can drift.
    expect(await systemBalance('system_coin_float')).toBe(
      -(POPULAR_PACK.coins + POPULAR_PACK.gems),
    );
  });
});

describe('economy arithmetic', () => {
  it('credits coins and gems separately from one pack', async () => {
    const user = await createUser();
    await buyPopularPack(user);

    expect(await getBalance('user_coins', user)).toBe(16_445);
    expect(await getBalance('user_gems', user)).toBe(5_355);
  });

  it('pays the host 30% of the gift value, not 60%', async () => {
    const user = await createUser();
    const host = await createUser();
    await buyValuePack(user);

    // Yacht: 19,500 coins. Face value ₹300 at the 65/₹ accounting rate.
    await postTransaction({
      txnType: 'gift_send',
      idempotencyKey: uuidv7(),
      identity: { gift_id: 'yacht', host_id: host, quantity: 1 },
      rates: RATES,
      legs: giftLegs({ userId: user, hostId: host, coins: 19_500, payoutRateBp: 6_000 }),
    });

    // points = coins × rate, NOT × 2. The host gets 60% of the COIN COUNT, and a
    // point is worth half a coin — the two-dial mechanic in one assertion.
    expect(await getBalance('host_points_held', host)).toBe(11_700);
    expect(await systemBalance('expense_host_payout')).toBe(9_000); // ₹90
    expect(await systemBalance('revenue_gifting')).toBe(-30_000); // ₹300
  });

  it('gives gems no payout at all', async () => {
    const user = await createUser();
    const host = await createUser();
    await buyPopularPack(user);
    await postTransaction({
      txnType: 'cosmetic_purchase',
      idempotencyKey: uuidv7(),
      identity: { item_id: 'frame_basic', duration_days: 30 },
      rates: RATES,
      legs: cosmeticPurchaseLegs({ userId: user, gems: 3_250 }),
    });

    expect(await getBalance('user_gems', user)).toBe(2_105);
    expect(await getBalance('host_points_held', host)).toBe(0);
    expect(await systemBalance('expense_host_payout')).toBe(0);
    expect(await systemBalance('revenue_cosmetics')).toBe(-5_000); // ₹50
  });

  it('converts coins to gems at +20%, one way', async () => {
    const user = await createUser();
    await buyPopularPack(user);
    await postTransaction({
      txnType: 'coin_to_gem_conversion',
      idempotencyKey: uuidv7(),
      identity: { coin_amount: 6_500 },
      rates: RATES,
      legs: conversionLegs({ userId: user, coins: 6_500 }),
    });

    expect(await getBalance('user_coins', user)).toBe(16_445 - 6_500);
    expect(await getBalance('user_gems', user)).toBe(5_355 + 7_800);
    expect(await systemBalance('discount_conversion_bonus')).toBe(2_000); // ₹20 minted
  });

  it('books the pack discount so every unit stays worth 1/65 of a rupee', async () => {
    const user = await createUser();
    await buyPopularPack(user);

    // 21,800 units at 65/₹ = ₹335.38 of face value, sold for ₹299.
    expect(await systemBalance('deferred_revenue')).toBe(-33_538);
    expect(await systemBalance('cash_web')).toBe(29_900);
    expect(await systemBalance('discount_pack')).toBe(3_638);
  });
});

describe('balance protection', () => {
  it('refuses a debit that would go negative', async () => {
    const user = await createUser();
    const host = await createUser();
    await buyPopularPack(user);

    await expect(
      postTransaction({
        txnType: 'gift_send',
        idempotencyKey: uuidv7(),
        identity: { gift_id: 'galaxy', host_id: host, quantity: 1 },
        rates: RATES,
        legs: giftLegs({ userId: user, hostId: host, coins: 999_999, payoutRateBp: 6_000 }),
      }),
    ).rejects.toThrow(/Not enough balance/);

    expect(await getBalance('user_coins', user)).toBe(16_445);
  });

  it('will not let gems be spent as coins', async () => {
    const user = await createUser();
    const host = await createUser();
    await buyPopularPack(user); // 16,445 coins + 5,355 gems

    // Gems are a separate account: a gift larger than the coin balance fails
    // even though coins + gems together would cover it.
    await expect(
      postTransaction({
        txnType: 'gift_send',
        idempotencyKey: uuidv7(),
        identity: { gift_id: 'big', host_id: host, quantity: 1 },
        rates: RATES,
        legs: giftLegs({ userId: user, hostId: host, coins: 20_000, payoutRateBp: 6_000 }),
      }),
    ).rejects.toThrow(/Not enough balance/);
  });
});

describe('idempotency', () => {
  it('returns the original response and applies the effect once', async () => {
    const user = await createUser();
    const key = uuidv7();
    const input = {
      txnType: 'free_coin_grant' as const,
      idempotencyKey: key,
      identity: { source: 'signup' },
      rates: RATES,
      legs: freeCoinGrantLegs({ userId: user, coins: 500 }),
      response: { granted: 500 },
    };

    const first = await postTransaction(input);
    const second = await postTransaction(input);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.txnId).toBe(first.txnId);
    expect(second.response).toEqual({ granted: 500 });
    expect(await getBalance('user_coins', user)).toBe(500); // credited once
  });

  it('rejects the same key used for a different operation', async () => {
    const user = await createUser();
    const key = uuidv7();

    await postTransaction({
      txnType: 'free_coin_grant',
      idempotencyKey: key,
      identity: { source: 'signup' },
      rates: RATES,
      legs: freeCoinGrantLegs({ userId: user, coins: 500 }),
    });

    await expect(
      postTransaction({
        txnType: 'free_coin_grant',
        idempotencyKey: key,
        identity: { source: 'referral' }, // different identity, same key
        rates: RATES,
        legs: freeCoinGrantLegs({ userId: user, coins: 2_000 }),
      }),
    ).rejects.toThrow(/used for a different operation/);

    expect(await getBalance('user_coins', user)).toBe(500);
  });

  it('applies once when identical requests race', async () => {
    const user = await createUser();
    const key = uuidv7();
    const input = {
      txnType: 'free_coin_grant' as const,
      idempotencyKey: key,
      identity: { source: 'signup' },
      rates: RATES,
      legs: freeCoinGrantLegs({ userId: user, coins: 500 }),
    };

    const results = await Promise.all([postTransaction(input), postTransaction(input)]);

    expect(new Set(results.map((r) => r.txnId)).size).toBe(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    expect(await getBalance('user_coins', user)).toBe(500);
  });
});

describe('concurrency', () => {
  it('never double-spends under parallel gifts', async () => {
    const user = await createUser();
    const host = await createUser();
    await buyPopularPack(user); // 16,445 coins

    // Twenty parallel 1,000-coin gifts against a balance that covers sixteen.
    const attempts = Array.from({ length: 20 }, (_, i) =>
      postTransaction({
        txnType: 'gift_send',
        idempotencyKey: uuidv7(),
        identity: { gift_id: 'rose', host_id: host, quantity: 1, n: i },
        rates: RATES,
        legs: giftLegs({ userId: user, hostId: host, coins: 1_000, payoutRateBp: 6_000 }),
      }).then(
        () => 'ok' as const,
        () => 'rejected' as const,
      ),
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r === 'ok').length;

    expect(succeeded).toBe(16);
    expect(await getBalance('user_coins', user)).toBe(445);
    expect(await getBalance('host_points_held', host)).toBe(16 * 600);
    expect(await balanceDrift()).toEqual([]);
    expect(await unbalancedTxns()).toEqual([]);
  });
});

describe('kill switch', () => {
  it('blocks a transaction type that has been switched off', async () => {
    const user = await createUser();
    const host = await createUser();
    await buyPopularPack(user);

    await setTxnTypeActive('gift_send', false);
    try {
      await expect(
        postTransaction({
          txnType: 'gift_send',
          idempotencyKey: uuidv7(),
          identity: { gift_id: 'rose', host_id: host, quantity: 1 },
          rates: RATES,
          legs: giftLegs({ userId: user, hostId: host, coins: 50, payoutRateBp: 6_000 }),
        }),
      ).rejects.toThrow(/temporarily unavailable/);
    } finally {
      await setTxnTypeActive('gift_send', true);
    }
  });

  it('refuses Phase 1 types that ship inactive', async () => {
    const user = await createUser();
    await expect(
      postTransaction({
        txnType: 'vip_purchase',
        idempotencyKey: uuidv7(),
        identity: { tier: 'gold', months: 1 },
        rates: RATES,
        legs: cosmeticPurchaseLegs({ userId: user, gems: 32_500 }),
      }),
    ).rejects.toThrow(/temporarily unavailable/);
  });
});
