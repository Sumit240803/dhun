// Cosmetics earned by reaching a level, rather than bought.
//
// `cosmetics.free_at_user_level` has been in the schema since migration 003 and
// was read by nothing until migration 030 — `frame_basic` advertised itself as
// free at level 31, the catalog returned that to the app, and nobody was ever
// granted one.
//
// ── Why this is not in the economy module ───────────────────────────────────
//
// Because no money moves. A level unlock spends no gems, writes no ledger
// transaction and has no idempotency key: it is a row in `user_cosmetics` that
// either exists or does not. `economy` is the sole writer of balances and this
// writes none, so it stays here with the rest of cosmetics ownership.
//
// The same reasoning as PK's scoreboard, and worth stating for the same
// reason: the next person to look will wonder why it is not in the ledger.

import { pool } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';
import { invalidateLook } from './looks.js';

/**
 * Grant everything this user's level now entitles them to.
 *
 * Returns the ids newly granted, so the caller can tell the user something
 * happened. An empty array is the overwhelmingly common case — most purchases
 * cross no threshold at all.
 *
 * ── Idempotent by the primary key, not by a check-then-insert ───────────────
 *
 * `ON CONFLICT (user_id, cosmetic_id)` is what makes this safe to call on every
 * purchase forever. The `RETURNING` clause combined with `xmax = 0` is how it
 * reports only the rows it actually created — reading back everything the user
 * owns would announce a frame they earned six months ago on every top-up.
 *
 * ── Granted UNEQUIPPED, deliberately ───────────────────────────────────────
 *
 * Buying a cosmetic equips it, because that is what the person just chose to
 * look like. A reward arriving in the background has not been chosen, and
 * silently changing how somebody appears in a room they are already in is not
 * a gift. It lands in their collection and they put it on.
 */
export async function grantLevelUnlocks(userId: string, level: number): Promise<string[]> {
  const { rows } = await pool.query<{ cosmetic_id: string; created: boolean }>(
    `INSERT INTO user_cosmetics (user_id, cosmetic_id, kind, expires_at, equipped, source)
     SELECT $1, c.id, c.kind, NULL, false, 'level'
       FROM cosmetics c
      WHERE c.free_at_user_level IS NOT NULL
        AND c.is_active
        AND c.free_at_user_level <= $2
     ON CONFLICT (user_id, cosmetic_id) DO UPDATE
        -- Upgrading a rental they already bought: the expiry goes away and it
        -- becomes theirs. Never the reverse — a level unlock cannot be
        -- downgraded back into a rental by buying it again.
        SET expires_at = NULL,
            source = 'level'
      WHERE user_cosmetics.source <> 'level'
     RETURNING cosmetic_id, (xmax = 0) AS created`,
    [userId, level],
  );

  // Both the inserts and the upgrades are news to the user: one is an item
  // they did not have, the other is an item that just stopped expiring.
  const granted = rows.map((row) => row.cosmetic_id);
  if (granted.length === 0) return [];

  // Their look did not change — nothing was equipped — but what they are
  // allowed to equip did, and the cache keys on ownership.
  invalidateLook(userId);
  logger.info('level unlocks granted', { user_id: userId, level, cosmetics: granted });

  return granted;
}
