import { z } from 'zod';
import { getConfigValue } from '../economy/index.js';

/**
 * The PK dials, from `app_config.pk`.
 *
 * Server-driven because every number here is a tuning decision somebody will
 * want to change at 9pm on a Saturday: how long a battle runs, how long an
 * invitation lives, whether PK is on at all. Day-1 non-negotiable #6.
 */
const schema = z.object({
  durationSeconds: z.number().int().min(30).max(3_600),
  minDurationSeconds: z.number().int().min(30).max(3_600),
  maxDurationSeconds: z.number().int().min(30).max(3_600),
  inviteTtlSeconds: z.number().int().min(10).max(600),
  queueTtlSeconds: z.number().int().min(10).max(1_800),
  maxStreakMultiplier: z.number().int().min(1).max(50),
  enabled: z.boolean(),
});

export type PkConfig = z.infer<typeof schema>;

/**
 * OFF, when the row is missing or malformed.
 *
 * The opposite default to most config in this codebase, and deliberately so.
 * Everything else here degrades toward "the feature still works"; PK degrades
 * toward "the feature is unavailable", because a battle running on
 * half-understood numbers — a zero-length window, a multiplier of 400 — is
 * worse for a host than no battle at all.
 */
const OFF: PkConfig = {
  durationSeconds: 300,
  minDurationSeconds: 60,
  maxDurationSeconds: 900,
  inviteTtlSeconds: 60,
  queueTtlSeconds: 180,
  maxStreakMultiplier: 5,
  enabled: false,
};

export async function pkConfig(): Promise<PkConfig> {
  const parsed = schema.safeParse(await getConfigValue('pk'));
  if (!parsed.success) return OFF;

  // A min above a max is a typo that would otherwise reject every duration a
  // host could possibly ask for, including the default.
  if (parsed.data.minDurationSeconds > parsed.data.maxDurationSeconds) return OFF;
  return parsed.data;
}

/**
 * The multiplier a streak earns.
 *
 * ── DISPLAY ONLY. This number must never reach the ledger. ──────────────────
 *
 * The payout ratio is set by exactly one number (`coins per ₹ ÷ 433.4`). A
 * multiplier that scaled points instead of the scoreboard would move that ratio
 * on every battle, and nobody would notice until a month of payouts had been
 * computed from it. Score is a game number; points are money; they are
 * different fields in different tables for this reason.
 *
 * Nothing in `pk.service.ts` passes this to `economy`, and nothing ever should.
 */
export function streakMultiplier(streak: number, config: PkConfig): number {
  if (streak <= 0) return 1;
  return Math.min(config.maxStreakMultiplier, streak + 1);
}
