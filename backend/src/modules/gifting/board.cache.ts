// The room leaderboard, cached for a few seconds.
//
// ── The load this removes ───────────────────────────────────────────────────
//
// Since the room was rebuilt, the board is read by every viewer in a room every
// five seconds — not only while a leaderboard sheet is open. The header's
// top-gifter rail and every seat's gift counter read from it, so it became room
// chrome rather than sheet content.
//
// That makes it the only query in the system whose cost scales with VIEWERS
// rather than with actions. At 300 concurrent that is 60 requests a second, each
// one a `GROUP BY` over `gift_sends` plus a room existence check — about 120
// queries a second against a 1 vCPU database, to compute the same answer over
// and over.
//
// Every viewer in a room gets an identical board. One query per room per five
// seconds serves all of them.
//
// ── Why in-memory and not Redis ─────────────────────────────────────────────
//
// Redis would share the cache across API instances; in-memory gives each
// instance its own. At one instance — which is the beta, and the next year —
// in-memory is a Map lookup instead of a network round trip, and it adds no new
// failure mode to a request that currently cannot fail on Redis being down.
//
// It degrades correctly rather than catastrophically: at ten instances this is
// ten queries per five seconds instead of one. Still sixty times better than
// none. If that ever matters, this file is where Redis goes.
//
// ── Why there is no invalidation on a gift ──────────────────────────────────
//
// The instinct is to clear a room's entry when a gift lands there. It is wrong
// here, and wrong in exactly the rooms this exists for: a room taking two gifts
// a second would invalidate faster than the TTL, so the cache would never hit
// in the busiest room on the platform.
//
// The board is at most `TTL_MS` behind, which is the client's own poll
// interval — invisible. And the gift itself is already pushed over the socket
// the instant it commits; the strips and the full-screen animation do not wait
// for this.

import { logger } from '../../infra/logger.js';
import type { LeaderboardEntry } from './gifts.service.js';

/**
 * Matched to the app's poll interval (`refetchInterval: 5_000`).
 *
 * Shorter wastes the cache — most polls would miss. Longer and the board
 * visibly lags a gift that has already played on screen.
 */
const TTL_MS = 5_000;

/**
 * Past this many rooms, expired entries are swept before anything new is added.
 *
 * A process that runs for weeks must not hold an entry for every room it has
 * ever served. The sweep is O(size) and runs rarely, which is the right shape
 * for a cache whose working set is "rooms live right now" — a few dozen.
 */
const SWEEP_ABOVE = 500;

interface Entry {
  expiresAt: number;
  board: LeaderboardEntry[];
}

const boards = new Map<string, Entry>();

/**
 * The board for a room, computed at most once per `TTL_MS`.
 *
 * `compute` is only called on a miss, so BOTH the aggregate and the room
 * existence check inside it are skipped on a hit. A room that does not exist
 * throws from `compute` and is never cached — otherwise a room created a second
 * later would keep 404ing for the rest of the window.
 */
export async function cachedLeaderboard(
  roomId: string,
  compute: () => Promise<LeaderboardEntry[]>,
): Promise<LeaderboardEntry[]> {
  const now = Date.now();
  const hit = boards.get(roomId);
  if (hit && hit.expiresAt > now) return hit.board;

  const board = await compute();

  if (boards.size > SWEEP_ABOVE) sweep(now);
  boards.set(roomId, { expiresAt: now + TTL_MS, board });
  return board;
}

/**
 * Drop a room's board immediately.
 *
 * Not called on a gift — see the header. This is for the cases where the board
 * is wrong rather than merely stale: a sender banned and their gifts reversed,
 * or a moderator action that should not wait five seconds to be visible.
 */
export function invalidateLeaderboard(roomId: string): void {
  boards.delete(roomId);
}

/** Test seam, and the shutdown path. */
export function clearLeaderboardCache(): void {
  boards.clear();
}

function sweep(now: number): void {
  let dropped = 0;
  for (const [roomId, entry] of boards) {
    if (entry.expiresAt <= now) {
      boards.delete(roomId);
      dropped += 1;
    }
  }
  // Every entry was still live, which means this process is genuinely serving
  // more than SWEEP_ABOVE rooms at once. Worth knowing before memory is.
  if (dropped === 0) {
    logger.warn('leaderboard cache above its sweep threshold with nothing expired', {
      size: boards.size,
    });
  }
}
