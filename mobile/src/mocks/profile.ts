// The Me screen's summary block.
//
// TODO(api): GET /v1/users/me/summary — M8. Coins, gems and level already come
// from the real GET /v1/wallet; everything here is the social half that has no
// endpoint yet.

export interface MockProfileSummary {
  /**
   * The short numeric id a user reads out loud to be found or to be tipped.
   * Not the internal uuid — that never leaves the server's logs.
   */
  publicId: string;
  friends: number;
  following: number;
  followers: number;
  /** Profile views since last opened. The reason anyone taps this row. */
  newVisitors: number;
  /** null = no VIP. Tier names are cosmetic, priced in gems. */
  vipTier: 'silver' | 'gold' | 'diamond' | null;
  /** Accrues on PURCHASE, never on spend — otherwise free coins grind levels. */
  userLevel: number;
  /** Host level. null for a viewer who has never gone live. */
  hostLevel: number | null;
  /** Withdrawable, in points. 130 points = ₹1. */
  points: number;
  /** Whether the 18+ PAN and face check has cleared. Gates every payout. */
  verified: boolean;
}

const SUMMARY: MockProfileSummary = {
  publicId: '85420939',
  friends: 0,
  following: 0,
  followers: 0,
  newVisitors: 0,
  vipTier: null,
  userLevel: 1,
  hostLevel: null,
  points: 0,
  verified: false,
};

/**
 * Deliberately all zeroes.
 *
 * This is what a real new account looks like, and the zero state is the one
 * most likely to ship broken — a wall of "0 Followers" that tells someone
 * nothing about what to do next. Mocking a flattering profile hides that.
 */
export function mockProfileSummary(): MockProfileSummary {
  return SUMMARY;
}
