// Money formatting. The single place any currency becomes a string.
//
// Four distinct quantities, four functions, no implicit conversion between them.
// Mixing them up is not a display bug — showing a user their point balance where
// their coin balance belongs makes them think they have been robbed.
//
// Everything here is a pure function over integers. Money is never a float, and
// the client never does arithmetic the server should have done.

import { paise as toPaise } from './units';
import type { Coins, Gems, Paise, Points } from './units';

/**
 * Indian digit grouping — the lakh system.
 *
 *   164945  →  1,64,945     (not 164,945)
 *
 * This is what an Indian user expects to read. Western grouping looks foreign
 * instantly, and the difference is most visible on exactly the large numbers a
 * whale sees in their wallet.
 */
function groupIndian(value: number): string {
  return Math.trunc(value).toLocaleString('en-IN');
}

/** Coins: purchased or earned free. Giftable. */
export function formatCoins(coins: Coins): string {
  return groupIndian(coins);
}

/** Gems: pack bonus or converted. Cosmetics only, zero host payout. */
export function formatGems(gems: Gems): string {
  return groupIndian(gems);
}

/** Points: what a host earns. 130 points = ₹1. */
export function formatPoints(points: Points): string {
  return groupIndian(points);
}

/**
 * Rupees from PAISE. The input is always paise — the server never sends rupees,
 * because a rupee value in JSON is a float waiting to lose a paisa.
 *
 *   29900  →  "₹299"
 *   29950  →  "₹299.50"
 */
export function formatRupees(paise: Paise, options: { alwaysShowPaise?: boolean } = {}): string {
  const isNegative = paise < 0;
  const absolute = Math.abs(Math.trunc(paise));
  const rupees = Math.trunc(absolute / 100);
  const remainder = absolute % 100;

  const showPaise = options.alwaysShowPaise || remainder !== 0;
  const body = showPaise
    ? `${groupIndian(rupees)}.${String(remainder).padStart(2, '0')}`
    : groupIndian(rupees);

  return `${isNegative ? '-' : ''}₹${body}`;
}

/**
 * Compact form for tight spaces — a room leaderboard, a gift badge.
 *
 * Uses Indian scale words, because "12.5L" reads naturally to this audience and
 * "1.2M" does not.
 */
export function formatCompact(value: number): string {
  const absolute = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absolute >= 10_000_000) return `${sign}${trimZero(absolute / 10_000_000)}Cr`;
  if (absolute >= 100_000) return `${sign}${trimZero(absolute / 100_000)}L`;
  if (absolute >= 1_000) return `${sign}${trimZero(absolute / 1_000)}K`;
  return `${sign}${absolute}`;
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/**
 * The rupee value a coin or gem balance represents, for display only.
 *
 * Uses the ACCOUNTING face value (65 units = ₹1), which is deliberately not the
 * pack rate (55/₹). Never use this to price anything — the server owns prices.
 * It exists so a wallet can show "about ₹252" beside a balance.
 */
export function approximateRupeesFromUnits(units: number, faceValuePerRupee = 65): Paise {
  return toPaise(Math.floor((units * 100) / faceValuePerRupee));
}

/** "2,000 coins + 3,300 gems" — the pack contents line. */
export function formatPackContents(coins: Coins, gems: Gems): string {
  if (gems === 0) return `${formatCoins(coins)} coins`;
  if (coins === 0) return `${formatGems(gems)} gems`;
  return `${formatCoins(coins)} coins + ${formatGems(gems)} gems`;
}
