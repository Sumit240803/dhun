// Cross-cutting domain types.
//
// Branded ids stop a HostId being passed where a UserId belongs. The money
// aliases are all plain integers — never floats, never a bare `amount`, because
// three units circulate and an unlabelled number is a bug waiting to happen.

export type UserId = string & { readonly __brand: 'UserId' };
export type HostId = string & { readonly __brand: 'HostId' };
export type RoomId = string & { readonly __brand: 'RoomId' };
export type GiftId = string & { readonly __brand: 'GiftId' };
export type TxnId = string & { readonly __brand: 'TxnId' };

/** Purchased or freely earned. Giftable to hosts. */
export type Coins = number;
/** Pack bonus, or converted from coins. Cosmetics only — zero host payout. */
export type Gems = number;
/** What hosts earn from gifts. 130 points = ₹1. */
export type Points = number;
/** INR as integer paise. Rupees never appear in the database. */
export type Paise = number;

/**
 * Ledger units. Gems are NOT a unit — one gem equals one coin in value, so they
 * are a separate ACCOUNT inside the coin unit. See ledger-decisions.md § A1.
 */
export type Unit = 'coin' | 'point' | 'paise';

export interface AuthedUser {
  id: UserId;
}
