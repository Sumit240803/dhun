// PK battles — the shape of the thing, before the backend has one.
//
// ── Why this exists now, with no server behind it ────────────────────────────
//
// PK is the single biggest gifting mechanic in apps of this kind: two hosts
// compete for a fixed window and each one's audience pays to push the bar.
// Building it needs a `pk_battles` table, matchmaking, scoring derived from
// gift timestamps inside the window, win streaks and a settlement — a milestone
// of its own.
//
// The UI does not need any of that to be correct. It needs a score per side, a
// deadline and a streak. So the stage is built against these types, fed by
// `devPk.ts` in development, and the day the backend lands the only change is
// where the object comes from.
//
// ── The two rules this file exists to write down ─────────────────────────────
//
// 1. `winMultiplier` scales the DISPLAYED SCORE and nothing else. It must never
//    touch points. The payout ratio is set by one number (`coins per ₹ ÷ 433.4`)
//    and a multiplier that reached the ledger would move it on every battle.
//    Score is a game number; points are money; they are different fields for
//    that reason.
//
// 2. Gifts are never pooled and never refunded to the losing side. A viewer
//    gifting a host is a purchase. If the losers' gifts came back, or the winner
//    took a pot funded by both audiences, it stops being gifting and becomes a
//    wager on an uncertain outcome — which is hard rule #1 territory. The winner
//    gets a streak badge. Everybody keeps the gifts they were sent.

// The wire shape lives in `@/api/types` — `api/` sits below `features/` and the
// server owns it. What stays here is the MATHS the stage draws with, which the
// server has no reason to know about, and the two rules above, which it does.

import type { PkBattle, PkSide, PkSupporter } from '@/api/types';

export type { PkBattle, PkSide, PkSupporter };

/** The app's name for a battle in progress. */
export type PkState = PkBattle;

export type PkPhase = PkBattle['phase'];

/** Which side is ahead, or null while they are level. */
export function pkLeader(pk: PkState): 0 | 1 | null {
  const [left, right] = pk.sides;
  if (left.score === right.score) return null;
  return left.score > right.score ? 0 : 1;
}

/**
 * Where the boundary sits, 0..1 from the left.
 *
 * Clamped to 12%..88% rather than 0..1, and that clamp is the whole reason this
 * is a function. A 0–50,000 battle would otherwise pin the bar to the edge and
 * erase the losing side's score, which is the number its audience is being
 * asked to change. Everyone can always see both.
 *
 * Level scores — including 0 vs 0 at the opening whistle — sit exactly centre.
 */
export function pkBoundary(pk: PkState): number {
  const [left, right] = pk.sides;
  const total = left.score + right.score;
  if (total <= 0) return 0.5;
  return Math.min(0.88, Math.max(0.12, left.score / total));
}

/** Seconds left on the clock, never negative. */
export function pkSecondsLeft(pk: PkState, now: number = Date.now()): number {
  return Math.max(0, Math.round((new Date(pk.endsAt).getTime() - now) / 1000));
}

/** `02:24`, as the references show it. */
export function formatPkClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
