// Economy constants.
//
// TEMPORARY HOME. These move into the server-driven `app_config` table in M4 —
// the docs are explicit that adding a gift or changing a rate must never need an
// app release. Until then they live here so the ledger has something to freeze
// onto each transaction.
//
// Every rate is an integer. Percentages are basis points (6000 = 60.00%).

export const ECONOMY = {
  /**
   * Accounting face value: 65 units = ₹1. Used ONLY for deferred revenue, so
   * every coin and gem is worth exactly the same amount everywhere in the books.
   * This is not what a user pays.
   */
  faceValueUnitsPerRupee: 65,

  /**
   * What a user actually gets: 55 coins = ₹1. THIS is the margin dial —
   * payout ratio is exactly `coinsPerRupee / 216.7`.
   */
  packCoinsPerRupee: 55,

  /** 130 points = ₹1. Points are worth half a coin, which turns an advertised 60% into a real 30%. */
  pointsPerRupee: 130,

  /** Coins to gems, one-way, +20%. */
  coinToGemRateBp: 12_000,

  /** Fallback only — payout_rate is a PER-GIFT field, never a global constant. */
  defaultGiftPayoutRateBp: 6_000,
} as const;

/** Face value of coins or gems, in paise. Floors — see ledger-decisions.md § A10. */
export function unitsToPaise(units: number): number {
  return Math.floor((units * 100) / ECONOMY.faceValueUnitsPerRupee);
}

/** Rupee value of a host's points, in paise. Floors. */
export function pointsToPaise(points: number): number {
  return Math.floor((points * 100) / ECONOMY.pointsPerRupee);
}

/**
 * Points a host earns from a gift.
 *
 *     points = coins × payout_rate
 *
 * Deliberately NOT × 2. The host receives 60% of the COIN COUNT as points, and
 * a point is worth half a coin — which is the whole two-dial mechanic, and why
 * an advertised 60% split pays out ~30% in reality.
 */
export function giftPoints(coins: number, payoutRateBp: number): number {
  return Math.floor((coins * payoutRateBp) / 10_000);
}

/** Gems received for coins converted, including the bonus. Floors. */
export function coinsToGems(coins: number, rateBp: number = ECONOMY.coinToGemRateBp): number {
  return Math.floor((coins * rateBp) / 10_000);
}
