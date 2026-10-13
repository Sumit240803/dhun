// The hourly room board.
//
// Which rooms have earned the most coins this hour, and where one room stands.
// It is the number on the second line of every reference screenshot, and it is
// not decoration: a host who can see they are 18% short of the next place has a
// reason to ask the room for one more gift, and that ask is the whole mechanic.
//
// ── A rollup, read by everyone ──────────────────────────────────────────────
//
// `rollup()` runs once a minute in the workers process and writes
// `room_hour_scores`; `rankFor()` reads one row. Migration 029's header has the
// reasoning — the short version is that ranking live would sort every gift in
// the last hour once per viewer per refresh, and that every viewer in a room
// must see the SAME position.
//
// Nothing here is money. The board summarises gifts the ledger has already
// settled, exactly as PK does.

import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { getConfigValue } from '../economy/index.js';

export interface RoomRank {
  /** Which board this is a position on. One for now; `pop`/`daily` later. */
  board: 'hour';
  /** `12`, or `100+` for a room outside the ranked slice. Shown verbatim. */
  position: string;
  /**
   * 0..1 toward the place above, or null when there is nothing to chase —
   * the room is first, or it is unranked and the next place is unknowable
   * without ranking everybody, which is what the slice exists to avoid.
   */
  progress: number | null;
  /** Coins this room has been gifted this hour. */
  coins: number;
  /** What the room directly above has. Null at rank 1 or when unranked. */
  nextUpCoins: number | null;
}

const schema = z.object({
  rankedPositions: z.number().int().min(10).max(1_000),
  refreshSeconds: z.number().int().min(15).max(600),
  retentionHours: z.number().int().min(1).max(720),
});

const DEFAULTS = { rankedPositions: 100, refreshSeconds: 60, retentionHours: 48 };

export async function boardConfig(): Promise<z.infer<typeof schema>> {
  const parsed = schema.safeParse(await getConfigValue('room_board'));
  return parsed.success ? parsed.data : DEFAULTS;
}

/**
 * Where this room stands, or null if it has earned nothing this hour.
 *
 * Null rather than "rank 100+ with 0 coins", because a room nobody has gifted
 * in has not entered the board — and the rail hides rather than showing a host
 * a zero. There is no encouragement in being told you are last.
 */
export async function rankFor(roomId: string): Promise<RoomRank | null> {
  const config = await boardConfig();

  const { rows } = await pool.query<{
    coins: string;
    rank: number | null;
    next_up_coins: string | null;
  }>(
    `SELECT coins, rank, next_up_coins
       FROM room_hour_scores
      WHERE room_id = $1 AND hour_start = date_trunc('hour', now())`,
    [roomId],
  );

  const row = rows[0];
  if (!row || Number(row.coins) <= 0) return null;

  const coins = Number(row.coins);
  const nextUp = row.next_up_coins === null ? null : Number(row.next_up_coins);

  return {
    board: 'hour',
    position: row.rank === null ? `${config.rankedPositions}+` : String(row.rank),
    // How far up the gap to the place above. `nextUp` is always >= coins (it
    // is the room ahead), so this cannot exceed 1 — but it is clamped anyway,
    // because a rollup written mid-gift could briefly disagree and a progress
    // bar past its own track is a visible bug.
    progress: nextUp === null || nextUp <= 0 ? null : Math.min(1, coins / nextUp),
    coins,
    nextUpCoins: nextUp,
  };
}

/**
 * Recompute the current hour.
 *
 * One statement. Ranking in SQL rather than in Node because the alternative is
 * pulling every room's hourly total into memory to sort it, and the database is
 * already holding the rows.
 *
 * `ON CONFLICT DO UPDATE` rather than delete-then-insert: the table is read
 * continuously by every open room, and a window where the row is missing shows
 * every host an empty rail once a minute.
 */
export async function rollup(): Promise<{ rooms: number }> {
  const config = await boardConfig();

  const { rowCount } = await pool.query(
    `WITH totals AS (
       SELECT g.room_id, r.host_user_id, SUM(g.coins)::bigint AS coins
         FROM gift_sends g
         JOIN rooms r ON r.id = g.room_id
        WHERE g.created_at >= date_trunc('hour', now())
          AND g.created_at <  date_trunc('hour', now()) + interval '1 hour'
        GROUP BY g.room_id, r.host_user_id
     ),
     ranked AS (
       SELECT room_id, host_user_id, coins,
              -- Ties share a position, and the next distinct total is what the
              -- room below is chasing. rank() leaves gaps after a tie, which
              -- is correct for a leaderboard: three rooms level at 1st means
              -- the next one is 4th, not 2nd.
              rank() OVER (ORDER BY coins DESC) AS position,
              LAG(coins) OVER (ORDER BY coins DESC) AS next_up_coins
         FROM totals
     )
     INSERT INTO room_hour_scores (hour_start, room_id, host_user_id, coins, rank, next_up_coins, computed_at)
     SELECT date_trunc('hour', now()), room_id, host_user_id, coins,
            CASE WHEN position <= $1 THEN position::int ELSE NULL END,
            next_up_coins,
            now()
       FROM ranked
     ON CONFLICT (hour_start, room_id) DO UPDATE
        SET coins = EXCLUDED.coins,
            rank = EXCLUDED.rank,
            next_up_coins = EXCLUDED.next_up_coins,
            computed_at = EXCLUDED.computed_at`,
    [config.rankedPositions],
  );

  return { rooms: rowCount ?? 0 };
}

/** The board itself — the top rooms this hour. */
export async function topRooms(limit = 20): Promise<
  {
    rank: number;
    roomId: string;
    publicId: number;
    title: string;
    hostName: string | null;
    coins: number;
    live: boolean;
  }[]
> {
  const { rows } = await pool.query<{
    rank: number;
    room_id: string;
    public_id: string;
    title: string;
    host_name: string | null;
    coins: string;
    live: boolean;
  }>(
    `SELECT s.rank, s.room_id, r.public_id, r.title, p.display_name AS host_name,
            s.coins, (r.ended_at IS NULL) AS live
       FROM room_hour_scores s
       JOIN rooms r ON r.id = s.room_id
       LEFT JOIN user_profiles p ON p.user_id = s.host_user_id
      WHERE s.hour_start = date_trunc('hour', now()) AND s.rank IS NOT NULL
      ORDER BY s.rank
      LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    rank: row.rank,
    roomId: row.room_id,
    publicId: Number(row.public_id),
    title: row.title,
    hostName: row.host_name,
    coins: Number(row.coins),
    live: row.live,
  }));
}

/** Drop finished hours. Called by the retention sweep. */
export async function purgeOldHours(): Promise<number> {
  const config = await boardConfig();
  const { rowCount } = await pool.query(
    `DELETE FROM room_hour_scores
      WHERE hour_start < date_trunc('hour', now()) - make_interval(hours => $1)`,
    [config.retentionHours],
  );
  return rowCount ?? 0;
}
