// Leg builders — one pure function per money flow.
//
// These are the executable form of the worked examples in
// backend/docs/ledger-decisions.md § A4. Keeping them pure means the arithmetic
// can be tested without a database, and postTransaction() stays generic.
//
// Every flow balances to zero in each unit it touches. The three books:
//   coin  — user balances and their system counterparty
//   point — host earnings and theirs
//   paise — the rupee view: cash, deferred revenue, revenue, expenses

import { Leg } from './ledger.types.js';
import { coinsToGems, giftPoints, pointsToPaise, unitsToPaise } from './rates.js';

export type PurchaseChannel = 'iap' | 'web' | 'reseller';

const CASH_ACCOUNT: Record<PurchaseChannel, string> = {
  iap: 'cash_iap',
  web: 'cash_web',
  reseller: 'cash_reseller',
};

const DISCOUNT_ACCOUNT: Record<PurchaseChannel, string> = {
  iap: 'discount_pack',
  web: 'discount_pack',
  reseller: 'discount_reseller',
};

/** Skips zero-amount legs — the ledger rejects them, and they carry no meaning. */
function nonZero(legs: Leg[]): Leg[] {
  return legs.filter((l) => l.amount !== 0);
}

/**
 * Coin pack purchased.
 *
 * A pack hands over more face value than it collects in cash (₹299 buys 21,800
 * units, worth ₹335.38 at the 65/₹ accounting rate). Booking that gap as a
 * discount is what keeps every coin and gem worth exactly 1/65 of a rupee
 * everywhere else in the system.
 */
export function purchaseLegs(p: {
  userId: string;
  coins: number;
  gems: number;
  cashPaise: number;
  channel: PurchaseChannel;
}): Leg[] {
  const faceValuePaise = unitsToPaise(p.coins + p.gems);
  const discountPaise = faceValuePaise - p.cashPaise;

  return nonZero([
    { accountCode: 'user_coins', scopeId: p.userId, unit: 'coin', amount: p.coins },
    { accountCode: 'user_gems', scopeId: p.userId, unit: 'coin', amount: p.gems },
    { accountCode: 'system_coin_float', unit: 'coin', amount: -(p.coins + p.gems) },

    { accountCode: CASH_ACCOUNT[p.channel], unit: 'paise', amount: p.cashPaise },
    { accountCode: DISCOUNT_ACCOUNT[p.channel], unit: 'paise', amount: discountPaise },
    { accountCode: 'deferred_revenue', unit: 'paise', amount: -faceValuePaise },
  ]);
}

/**
 * Gift sent to a host — eight legs across all three books.
 *
 * This is where "coin float is a liability, revenue is recognised on spend"
 * becomes real: the coins leave the user's liability and become revenue at this
 * instant, while points are issued as a brand-new liability.
 */
export function giftLegs(p: {
  userId: string;
  hostId: string;
  coins: number;
  payoutRateBp: number;
}): Leg[] {
  const points = giftPoints(p.coins, p.payoutRateBp);
  const giftValuePaise = unitsToPaise(p.coins);
  const payoutPaise = pointsToPaise(points);

  return nonZero([
    { accountCode: 'user_coins', scopeId: p.userId, unit: 'coin', amount: -p.coins },
    { accountCode: 'system_coin_float', unit: 'coin', amount: p.coins },

    { accountCode: 'system_point_float', unit: 'point', amount: -points },
    { accountCode: 'host_points_held', scopeId: p.hostId, unit: 'point', amount: points },

    { accountCode: 'deferred_revenue', unit: 'paise', amount: giftValuePaise },
    { accountCode: 'revenue_gifting', unit: 'paise', amount: -giftValuePaise },
    { accountCode: 'expense_host_payout', unit: 'paise', amount: payoutPaise },
    { accountCode: 'points_payable', unit: 'paise', amount: -payoutPaise },
  ]);
}

/**
 * Cosmetic bought with gems. Four legs, and crucially NO point legs at all —
 * this is the zero-payout path that carries the margin.
 */
export function cosmeticPurchaseLegs(p: { userId: string; gems: number }): Leg[] {
  const valuePaise = unitsToPaise(p.gems);

  return nonZero([
    { accountCode: 'user_gems', scopeId: p.userId, unit: 'coin', amount: -p.gems },
    { accountCode: 'system_coin_float', unit: 'coin', amount: p.gems },

    { accountCode: 'deferred_revenue', unit: 'paise', amount: valuePaise },
    { accountCode: 'revenue_cosmetics', unit: 'paise', amount: -valuePaise },
  ]);
}

/**
 * Coins converted to gems, one way, with the +20% bonus.
 *
 * The bonus mints units that nobody paid for, so it needs a source in both
 * books: the coin float shrinks further, and the extra face value is booked as
 * contra-revenue.
 *
 * Never build the reverse. Gems converting back to coins would let a whale turn
 * cosmetics money into giftable coins and the entire payout design collapses.
 */
export function conversionLegs(p: { userId: string; coins: number; rateBp?: number }): Leg[] {
  const gems = coinsToGems(p.coins, p.rateBp);
  const bonusUnits = gems - p.coins;
  const bonusPaise = unitsToPaise(bonusUnits);

  return nonZero([
    { accountCode: 'user_coins', scopeId: p.userId, unit: 'coin', amount: -p.coins },
    { accountCode: 'user_gems', scopeId: p.userId, unit: 'coin', amount: gems },
    { accountCode: 'system_coin_float', unit: 'coin', amount: -bonusUnits },

    { accountCode: 'discount_conversion_bonus', unit: 'paise', amount: bonusPaise },
    { accountCode: 'deferred_revenue', unit: 'paise', amount: -bonusPaise },
  ]);
}

/**
 * Free coins: signup, daily check-in, watch reward, follow, share, referral.
 *
 * These are ordinary coins — fully giftable at the normal 60% split, no expiry,
 * no separate balance. The cost lands in expense_free_coins, which is what the
 * "at most 8% of paid revenue" budget check reads.
 */
export function freeCoinGrantLegs(p: { userId: string; coins: number }): Leg[] {
  const valuePaise = unitsToPaise(p.coins);

  return nonZero([
    { accountCode: 'system_coin_float', unit: 'coin', amount: -p.coins },
    { accountCode: 'user_coins', scopeId: p.userId, unit: 'coin', amount: p.coins },

    { accountCode: 'expense_free_coins', unit: 'paise', amount: valuePaise },
    { accountCode: 'deferred_revenue', unit: 'paise', amount: -valuePaise },
  ]);
}
