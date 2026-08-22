// Branded money units.
//
// These are all `number` at runtime, but TypeScript will refuse to pass a Points
// where a Coins belongs. That matters because the three are NOT interchangeable:
// 11,700 points and 11,700 coins are different amounts of money, and the bug
// where they get swapped is invisible in review.

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/** Purchased or earned free. Giftable to hosts at the gift's payout rate. */
export type Coins = Brand<number, 'Coins'>;
/** Pack bonus or converted from coins. Cosmetics only — zero host payout. */
export type Gems = Brand<number, 'Gems'>;
/** What a host earns. 130 points = ₹1, which is half a coin's value. */
export type Points = Brand<number, 'Points'>;
/** INR as an integer. Rupees never cross the wire as a float. */
export type Paise = Brand<number, 'Paise'>;

// Constructors. Explicit on purpose: converting a raw API number into a unit
// should be a visible decision at the boundary, not an implicit cast anywhere.
export const coins = (n: number) => Math.trunc(n) as Coins;
export const gems = (n: number) => Math.trunc(n) as Gems;
export const points = (n: number) => Math.trunc(n) as Points;
export const paise = (n: number) => Math.trunc(n) as Paise;
