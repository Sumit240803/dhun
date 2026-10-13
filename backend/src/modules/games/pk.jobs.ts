// The three things that have to happen to a battle without anybody asking.
//
//   · a window closes          → settle it
//   · two hosts are waiting    → match them
//   · an invitation goes stale → expire it
//
// All three run in the workers process under an advisory lock, so two instances
// never both settle the same battle. Each is idempotent anyway — `settle()`
// guards on `state = 'live'` and matching deletes the queue rows inside the
// same transaction — because a lock is a performance measure, not a
// correctness one.

import { pool, withTransaction } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';
import { pkConfig } from './pk.config.js';
import { announce, byId, settle } from './pk.service.js';

/**
 * Settle everything whose clock has run out.
 *
 * Runs often — every 5 seconds — because the app shows a countdown and a
 * result that arrives twenty seconds after zero looks broken. The query is
 * served by `pk_due_idx` on (ends_at) WHERE state = 'live', so an empty sweep
 * is an index scan over nothing.
 */
export async function settleDuePkBattles(): Promise<{ settled: number }> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM pk_battles WHERE state = 'live' AND ends_at <= now() ORDER BY ends_at LIMIT 100`,
  );

  let settled = 0;
  for (const row of rows) {
    // One at a time, and one failure does not take the sweep down with it:
    // a battle that cannot be settled must not block the forty behind it.
    try {
      if (await settle(row.id)) settled += 1;
    } catch (error) {
      logger.error('pk settle failed', error, { battle_id: row.id });
    }
  }

  return { settled };
}

/**
 * Pair up whoever is waiting for a random battle.
 *
 * ── Why the pairing is oldest-first and not random ──────────────────────────
 *
 * "Random PK" describes who you get, not how long you wait. Shuffling the queue
 * means a host can sit in it while later arrivals are matched around them,
 * which is the one thing that would make people stop using it.
 *
 * ── Why each pair is its own transaction ────────────────────────────────────
 *
 * Six waiting hosts are three independent battles. Settling them in one
 * transaction means a conflict on the third pair rolls back the first two, and
 * those two hosts are already on camera being told a battle started.
 */
export async function matchPkQueue(): Promise<{ matched: number; expired: number }> {
  const config = await pkConfig();
  if (!config.enabled) return { matched: 0, expired: 0 };

  // Anyone who has waited too long, or whose room has since ended. A queue that
  // keeps dead rooms in it matches live hosts against nobody.
  const { rowCount: expired } = await pool.query(
    `DELETE FROM pk_queue q
      USING rooms r
      WHERE r.id = q.room_id
        AND (r.ended_at IS NOT NULL OR q.joined_at < now() - make_interval(secs => $1))`,
    [config.queueTtlSeconds],
  );

  const { rows: waiting } = await pool.query<{ user_id: string; room_id: string }>(
    `SELECT q.user_id, q.room_id
       FROM pk_queue q
       JOIN rooms r ON r.id = q.room_id AND r.ended_at IS NULL
      WHERE NOT EXISTS (
              SELECT 1 FROM pk_battles b
               WHERE b.state IN ('pending', 'live')
                 AND (b.home_user_id = q.user_id OR b.away_user_id = q.user_id)
            )
      ORDER BY q.joined_at
      LIMIT 50`,
  );

  let matched = 0;
  for (let i = 0; i + 1 < waiting.length; i += 2) {
    const home = waiting[i]!;
    const away = waiting[i + 1]!;

    try {
      const battleId = await withTransaction(async (client) => {
        // Both rows deleted inside the transaction that creates the battle, so
        // a host can never be matched twice. If the insert fails on the unique
        // index, the deletes roll back and they stay in the queue.
        const { rowCount } = await client.query(
          'DELETE FROM pk_queue WHERE user_id = ANY($1::uuid[])',
          [[home.user_id, away.user_id]],
        );
        // Somebody left the queue between the SELECT and here.
        if (rowCount !== 2) return null;

        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO pk_battles (id, mode, state, home_room_id, away_room_id,
                                   home_user_id, away_user_id, started_at, ends_at)
                VALUES (gen_random_uuid(), '1v1', 'live', $1, $2, $3, $4,
                        now(), now() + make_interval(secs => $5))
             RETURNING id`,
          [home.room_id, away.room_id, home.user_id, away.user_id, config.durationSeconds],
        );
        return rows[0]?.id ?? null;
      });

      if (battleId !== null) {
        announce(await byId(battleId), 'pk:started');
        matched += 1;
        logger.info('pk matched', { battle_id: battleId, home: home.user_id, away: away.user_id });
      }
    } catch (error) {
      // A unique-index collision here means one of the two started a battle by
      // invitation in the last second. Ordinary, and the next sweep re-reads
      // the queue without them.
      logger.warn('pk match failed', { home: home.user_id, away: away.user_id, error: String(error) });
    }
  }

  return { matched, expired: expired ?? 0 };
}

/**
 * Expire invitations nobody answered.
 *
 * Cosmetic rather than correctness — `acceptInvite` already refuses an expired
 * one — but an inbox that fills with dead invitations is an inbox nobody opens.
 */
export async function expirePkInvites(): Promise<{ expired: number }> {
  const { rowCount } = await pool.query(
    `UPDATE pk_invites SET state = 'expired', responded_at = now()
      WHERE state = 'pending' AND expires_at <= now()`,
  );
  return { expired: rowCount ?? 0 };
}
