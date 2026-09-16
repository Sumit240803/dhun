// PUBLIC API of the gifting module.
//
// Sending a gift in a room, and the room leaderboard. The money itself moves
// through economy's ledger — this module decides whether a send is allowed and
// records what was sent, and never writes a balance.

export { buildGiftsRouter } from './gifts.routes.js';

export { GIFT_QUANTITIES, roomLeaderboard, sendGift } from './gifts.service.js';
export type { GiftQuantity, GiftView, LeaderboardEntry, SendGiftResult } from './gifts.service.js';
