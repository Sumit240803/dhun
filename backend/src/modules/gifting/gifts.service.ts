// Sending a gift, and the room leaderboard it feeds.
//
// ── What a send is ──────────────────────────────────────────────────────────
//
// One tap, one ledger transaction. A combo (x10, x99, x520, x999) is the same
// transaction with a quantity, never N of them (ledger-decisions § C10). The
// eight legs are economy's `giftLegs`; what this file adds is everything the
// ledger cannot know — whether the room is live, whether the recipient is
// actually in it, whether the sender is allowed to give to them.
//
// ── Two paths out, as § B8 decided ──────────────────────────────────────────
//
//   · FAST: straight after commit, the gift is published to the room so every
//     strip and animation fires within a round trip. Best-effort: a dropped
//     publish costs one missed animation, never the money.
//   · DURABLE: the outbox row, written inside the transaction, for analytics
//     and everything financial downstream.
//
// And one record that is neither: a `gift_sends` row, written inside the same
// transaction as the entries, so the leaderboard and a host's earnings read
// something that cannot disagree with the ledger.

import type { PoolClient } from 'pg';
import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { publishToRoom } from '../../infra/roomBus.js';
import { lookFor, type UserLook } from '../cosmetics/index.js';
import {
  ECONOMY,
  findCompletedTransaction,
  getBalance,
  getGiftForSend,
  giftLegs,
  giftPoints,
  postTransaction,
} from '../economy/index.js';

/** The combo multipliers. Anything else would turn one tap into any amount. */
export const GIFT_QUANTITIES = [1, 10, 99, 520, 999] as const;
export type GiftQuantity = (typeof GIFT_QUANTITIES)[number];

/**
 * A gift as a room is told about it.
 *
 * Mirrors `GiftView` in gateway/protocol.ts — deliberately not imported, for
 * the same reason as realtime/announce.ts: the API process has no business
 * loading the gateway's protocol. The gifting tests assert the published shape.
 */
export interface GiftView {
  /** The ledger transaction id. Clients dedupe on it. */
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  /** The sender's equipped avatar frame — its art and the ring drawn without it. */
  senderFrame: UserLook['frame'];
  recipientId: string;
  recipientName: string | null;
  giftId: string;
  giftName: string;
  giftIcon: string | null;
  tier: number;
  /** Drives the full-screen layer: `basic` gifts show as a strip only. */
  effect: string;
  animationAsset: string | null;
  coinPrice: number;
  quantity: number;
}

export interface SendGiftResult {
  gift: GiftView;
  coinsSpent: number;
  /** The sender's coin balance after this send. */
  balance: { coins: number };
  replayed: boolean;
}

interface Participants {
  host_user_id: string;
  ended_at: Date | null;
  sender_banned: boolean;
  recipient_seated: boolean;
  recipient_blocked_sender: boolean;
  recipient_status: string | null;
  sender_name: string | null;
  sender_avatar: string | null;
  recipient_name: string | null;
}

/**
 * Everything a send needs to know about the room and the two people, in one
 * round trip. A gift storm is exactly when an extra query per send shows up.
 */
async function loadParticipants(input: {
  roomId: string;
  senderId: string;
  recipientId: string;
}): Promise<Participants> {
  const { rows } = await pool.query<Participants>(
    `SELECT r.host_user_id,
            r.ended_at,
            EXISTS (SELECT 1 FROM room_bans b
                     WHERE b.room_id = r.id AND b.user_id = $2) AS sender_banned,
            EXISTS (SELECT 1 FROM room_seats s
                     WHERE s.room_id = r.id AND s.user_id = $3) AS recipient_seated,
            EXISTS (SELECT 1 FROM blocks k
                     WHERE k.blocker_user_id = $3 AND k.blocked_user_id = $2) AS recipient_blocked_sender,
            (SELECT u.status FROM users u WHERE u.id = $3) AS recipient_status,
            sp.display_name AS sender_name,
            sp.avatar_url   AS sender_avatar,
            rp.display_name AS recipient_name
       FROM rooms r
       LEFT JOIN user_profiles sp ON sp.user_id = $2
       LEFT JOIN user_profiles rp ON rp.user_id = $3
      WHERE r.id = $1`,
    [input.roomId, input.senderId, input.recipientId],
  );

  const row = rows[0];
  if (!row) throw new AppError('ROOM_NOT_FOUND', 'That room does not exist', 404);
  return row;
}

/**
 * Sends a gift.
 *
 * The order is load-bearing:
 *
 *   1. REPLAY FIRST. A gift sent a moment before the room ended, whose response
 *      was lost, must come back as the gift it was on retry — not as "room
 *      ended", which would tell the sender a charge that went through did not.
 *   2. Validate against the live state of the room and the catalog.
 *   3. Post. The balance check happens inside, under the row lock, because a
 *      check out here would race every other tap from the same thumb.
 *   4. Announce, only for a send that actually happened now.
 */
export async function sendGift(input: {
  senderId: string;
  roomId: string;
  recipientId: string;
  giftId: string;
  quantity: GiftQuantity;
  /** The unit price the client displayed. */
  expectedCoinPrice: number;
  idempotencyKey: string;
}): Promise<SendGiftResult> {
  const identity = {
    gift_id: input.giftId,
    recipient_id: input.recipientId,
    room_id: input.roomId,
    quantity: input.quantity,
  };

  const prior = await findCompletedTransaction(input.idempotencyKey, identity);
  if (prior) return withBalance(prior.response, input.senderId, true);

  // Before any query. Coins bought on a stolen card and gifted to yourself
  // come back out as a bank payout — the cash-out half of card fraud.
  if (input.senderId === input.recipientId) {
    throw new AppError('GIFT_TO_SELF', 'You cannot send a gift to yourself', 422);
  }

  const gift = await getGiftForSend(input.giftId);

  // The price the user saw is the price they agreed to. Charging a different
  // one — because an admin repriced the gift while the sheet was open — is a
  // support ticket at best and a chargeback at worst.
  if (gift.coinPrice !== input.expectedCoinPrice) {
    throw new AppError('GIFT_PRICE_CHANGED', 'The price of this gift has changed', 409, {
      coinPrice: gift.coinPrice,
    });
  }

  const [room, senderLook] = await Promise.all([
    loadParticipants(input),
    lookFor(input.senderId),
  ]);

  if (room.ended_at !== null) throw new AppError('ROOM_ENDED', 'This room has ended', 410);
  if (room.sender_banned) {
    throw new AppError('ROOM_BANNED', 'You have been removed from this room', 403);
  }

  // The host, or someone on a seat. Presence is not mirrored in Postgres, so
  // "in the room" cannot mean "connected" — and a gift to someone who merely
  // passed through would pay a stranger the room never saw.
  const recipientInRoom = input.recipientId === room.host_user_id || room.recipient_seated;
  if (!recipientInRoom || room.recipient_status !== 'active') {
    throw new AppError('RECIPIENT_NOT_IN_ROOM', 'That person is not on stage in this room', 409);
  }

  // Deliberately the same code as a recipient who is not there. Telling a
  // sender they have been blocked is how blocks get routed around.
  if (room.recipient_blocked_sender) {
    throw new AppError('RECIPIENT_NOT_IN_ROOM', 'That person is not on stage in this room', 409);
  }

  const coins = gift.coinPrice * input.quantity;
  const points = giftPoints(coins, gift.payoutRateBp);

  const buildView = (txnId: string): GiftView => ({
    id: txnId,
    senderId: input.senderId,
    senderName: room.sender_name ?? '',
    senderAvatar: room.sender_avatar,
    senderFrame: senderLook.frame,
    recipientId: input.recipientId,
    recipientName: room.recipient_name,
    giftId: gift.id,
    giftName: gift.name,
    giftIcon: gift.iconAsset,
    tier: gift.tier,
    effect: gift.effect,
    animationAsset: gift.animationAsset,
    coinPrice: gift.coinPrice,
    quantity: input.quantity,
  });

  const result = await postTransaction({
    txnType: 'gift_send',
    idempotencyKey: input.idempotencyKey,
    identity,
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
      payoutRateBp: gift.payoutRateBp,
    },
    actorUserId: input.senderId,
    legs: giftLegs({
      userId: input.senderId,
      hostId: input.recipientId,
      coins,
      payoutRateBp: gift.payoutRateBp,
    }),
    withinTransaction: (client, txnId) =>
      recordSend(client, {
        txnId,
        roomId: input.roomId,
        senderId: input.senderId,
        recipientId: input.recipientId,
        giftId: gift.id,
        quantity: input.quantity,
        unitPrice: gift.coinPrice,
        coins,
        points,
        payoutRateBp: gift.payoutRateBp,
      }),
    events: [
      {
        eventType: 'gift_sent',
        // Per ROOM, so a room's gifts are consumed in the order they were sent.
        partitionKey: input.roomId,
        payload: {
          room_id: input.roomId,
          sender_id: input.senderId,
          recipient_id: input.recipientId,
          gift_id: gift.id,
          tier: gift.tier,
          quantity: input.quantity,
          coins,
          points,
          payout_rate_bp: gift.payoutRateBp,
        },
      },
    ],
    response: (txnId) => ({ gift: buildView(txnId), coinsSpent: coins }),
  });

  // Only a send that happened NOW is announced. A replay that raced its own
  // original already had its moment on screen, and clients dedupe regardless.
  if (!result.replayed) {
    const view = (result.response as { gift: GiftView }).gift;
    publishToRoom(input.roomId, { t: 'gift', roomId: input.roomId, gift: view });

    logger.info('gift sent', {
      txn_id: result.txnId,
      room_id: input.roomId,
      gift_id: gift.id,
      quantity: input.quantity,
      coins,
    });
  }

  return withBalance(result.response, input.senderId, result.replayed);
}

async function recordSend(
  client: PoolClient,
  row: {
    txnId: string;
    roomId: string;
    senderId: string;
    recipientId: string;
    giftId: string;
    quantity: number;
    unitPrice: number;
    coins: number;
    points: number;
    payoutRateBp: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO gift_sends
       (txn_id, room_id, sender_user_id, recipient_user_id, gift_id, quantity,
        unit_price, coins, points, payout_rate_bp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      row.txnId,
      row.roomId,
      row.senderId,
      row.recipientId,
      row.giftId,
      row.quantity,
      row.unitPrice,
      row.coins,
      row.points,
      row.payoutRateBp,
    ],
  );
}

/**
 * The stored response plus a FRESH balance.
 *
 * The balance is read now rather than stored with the response, because on a
 * replay the stored one would be stale by every gift sent since.
 */
async function withBalance(
  response: Record<string, unknown>,
  senderId: string,
  replayed: boolean,
): Promise<SendGiftResult> {
  const stored = response as { gift?: GiftView; coinsSpent?: number };

  // A replay after the 7-day response purge has no payload left to return.
  // Nobody retries a gift a week later, but the answer must still be honest
  // rather than a crash on a missing field.
  if (!stored.gift) {
    throw new AppError('GIFT_ALREADY_SENT', 'This gift was already sent', 409);
  }

  return {
    gift: stored.gift,
    coinsSpent: stored.coinsSpent ?? 0,
    balance: { coins: await getBalance('user_coins', senderId) },
    replayed,
  };
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  coins: number;
}

/**
 * Who has given the most in this room.
 *
 * Read from `gift_sends`, which is written in the same transaction as the
 * money — so the board can never show a gift the ledger does not have, or miss
 * one it does. Ties go to whoever reached the total first.
 */
export async function roomLeaderboard(roomId: string, limit = 20): Promise<LeaderboardEntry[]> {
  // An unknown room is a 404, not an empty board — an empty board is a true
  // statement about a real room with no gifts yet, and the two should not look
  // the same to a client.
  const exists = await pool.query('SELECT 1 FROM rooms WHERE id = $1', [roomId]);
  if (exists.rowCount === 0) throw new AppError('ROOM_NOT_FOUND', 'That room does not exist', 404);

  const { rows } = await pool.query<{
    sender_user_id: string;
    coins: string;
    display_name: string | null;
    avatar_url: string | null;
  }>(
    `SELECT g.sender_user_id, g.coins, p.display_name, p.avatar_url
       FROM (SELECT sender_user_id, SUM(coins) AS coins, MAX(created_at) AS last_at
               FROM gift_sends
              WHERE room_id = $1
              GROUP BY sender_user_id) g
       LEFT JOIN user_profiles p ON p.user_id = g.sender_user_id
      ORDER BY g.coins DESC, g.last_at ASC
      LIMIT $2`,
    [roomId, limit],
  );

  return rows.map((row, index) => ({
    rank: index + 1,
    userId: row.sender_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    coins: Number(row.coins),
  }));
}
