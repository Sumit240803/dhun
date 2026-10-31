// Super messages: a paid, highlighted, pinned line in one room.
//
// Priced in GEMS from the `super_message` catalog row, so it pays the host
// nothing (invariant #8) and rides the cosmetic_purchase transaction type and
// legs. The row that makes it a message — which room, what text — is written
// inside the ledger's transaction (invariant #7's rule, applied here), and
// the room is told only after the commit.
//
// The text goes through the same filter as chat BEFORE any gems move: a
// blocked line is refused and costs nothing, a masked line is delivered masked
// and the original is kept for a moderator exactly as room_messages keeps it.

import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { publishToRoom } from '../../infra/roomBus.js';
import type { UserLook } from '../../shared/cosmeticStyle.js';
import { ECONOMY, cosmeticPurchaseLegs, getConfigValue, getCosmeticForSale, postTransaction } from '../economy/index.js';
import { filterText } from '../moderation/index.js';
import { lookFor } from './looks.js';

export const SUPER_MESSAGE_ID = 'super_message';

export interface SuperView {
  /** The ledger transaction id. Clients dedupe on it. */
  id: string;
  roomId: string;
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  look: UserLook;
  body: string;
  gems: number;
  at: string;
  /** How long the room pins it. */
  pinSeconds: number;
}

const schema = z
  .object({ pinSeconds: z.number().int().min(5).max(600), maxLength: z.number().int().min(10).max(200) })
  .strict();
const DEFAULTS = { pinSeconds: 30, maxLength: 120 };

export async function superMessageConfig(): Promise<z.infer<typeof schema>> {
  const parsed = schema.safeParse(await getConfigValue('super_message'));
  return parsed.success ? parsed.data : DEFAULTS;
}

async function sender(userId: string): Promise<{ name: string | null; avatarUrl: string | null }> {
  const { rows } = await pool.query<{ display_name: string | null; avatar_url: string | null }>(
    'SELECT display_name, avatar_url FROM user_profiles WHERE user_id = $1',
    [userId],
  );
  return { name: rows[0]?.display_name ?? null, avatarUrl: rows[0]?.avatar_url ?? null };
}

export async function sendSuperMessage(input: {
  userId: string;
  roomId: string;
  body: string;
  expectedGemPrice: number;
  idempotencyKey: string;
}): Promise<{ message: SuperView; replayed: boolean }> {
  const config = await superMessageConfig();
  if (input.body.length > config.maxLength) {
    throw new AppError('VALIDATION_FAILED', 'That message is too long', 422, {
      issues: [{ field: 'body', code: 'too_big', message: `At most ${config.maxLength} characters` }],
    });
  }

  const room = await pool.query<{ ended_at: Date | null }>('SELECT ended_at FROM rooms WHERE id = $1', [
    input.roomId,
  ]);
  if (!room.rows[0]) throw new AppError('ROOM_NOT_FOUND', 'That room does not exist', 404);
  if (room.rows[0].ended_at !== null) throw new AppError('ROOM_ENDED', 'This room has ended', 410);
  const banned = await pool.query('SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2', [
    input.roomId,
    input.userId,
  ]);
  if (banned.rowCount) throw new AppError('ROOM_BANNED', 'You cannot post in this room', 403);

  // Filtered before anything is charged. Nobody pays to be refused.
  const filtered = filterText(input.body);
  if (filtered.verdict === 'blocked') {
    throw new AppError('MESSAGE_BLOCKED', 'That message was not sent', 422);
  }

  const item = await getCosmeticForSale(SUPER_MESSAGE_ID);
  if (item.gemPrice !== input.expectedGemPrice) {
    throw new AppError('COSMETIC_PRICE_CHANGED', 'The price has changed', 409, { gemPrice: item.gemPrice });
  }

  const result = await postTransaction({
    txnType: 'cosmetic_purchase',
    idempotencyKey: input.idempotencyKey,
    identity: { item_id: SUPER_MESSAGE_ID, room_id: input.roomId, body: input.body },
    rates: { faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee, pointsPerRupee: ECONOMY.pointsPerRupee },
    actorUserId: input.userId,
    legs: cosmeticPurchaseLegs({ userId: input.userId, gems: item.gemPrice }),
    withinTransaction: async (client, txnId) => {
      // The ORIGINAL text, like room_messages: evidence for a report.
      await client.query(
        'INSERT INTO super_messages (txn_id, room_id, user_id, body, gems) VALUES ($1, $2, $3, $4, $5)',
        [txnId, input.roomId, input.userId, input.body, item.gemPrice],
      );
    },
    events: [
      {
        eventType: 'super_message_sent',
        partitionKey: input.userId,
        payload: { user_id: input.userId, room_id: input.roomId, gems: item.gemPrice },
      },
    ],
    response: () => ({ gems: item.gemPrice, body: filtered.body }),
  });

  const [who, look] = await Promise.all([sender(input.userId), lookFor(input.userId)]);
  const stored = result.response as { gems?: number; body?: string };
  const message: SuperView = {
    id: result.txnId,
    roomId: input.roomId,
    userId: input.userId,
    name: who.name,
    avatarUrl: who.avatarUrl,
    look,
    body: stored.body ?? filtered.body,
    gems: Number(stored.gems ?? item.gemPrice),
    at: new Date().toISOString(),
    pinSeconds: config.pinSeconds,
  };

  if (!result.replayed) {
    publishToRoom(input.roomId, { t: 'super', roomId: input.roomId, message });
    logger.info('super message sent', { txn_id: result.txnId, room_id: input.roomId, gems: item.gemPrice });
  }
  return { message, replayed: result.replayed };
}

/** The one still pinned when someone walks in, or null. */
export async function currentSuperMessage(roomId: string): Promise<SuperView | null> {
  const config = await superMessageConfig();
  const { rows } = await pool.query<{
    txn_id: string;
    user_id: string;
    body: string;
    gems: string;
    created_at: Date;
    display_name: string | null;
    avatar_url: string | null;
  }>(
    `SELECT s.txn_id, s.user_id, s.body, s.gems, s.created_at, p.display_name, p.avatar_url
       FROM super_messages s
       LEFT JOIN user_profiles p ON p.user_id = s.user_id
      WHERE s.room_id = $1 AND s.created_at > now() - make_interval(secs => $2)
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [roomId, config.pinSeconds],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.txn_id,
    roomId,
    userId: row.user_id,
    name: row.display_name,
    avatarUrl: row.avatar_url,
    look: await lookFor(row.user_id),
    body: filterText(row.body).body,
    gems: Number(row.gems),
    at: row.created_at.toISOString(),
    pinSeconds: config.pinSeconds,
  };
}
