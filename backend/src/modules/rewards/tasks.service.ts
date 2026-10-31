// Daily tasks: a short list of things to do today for free coins.
//
// Progress is DERIVED from what already happened — lines chatted, gifts
// sent, follows made, watch intervals paid — never counted into a column
// the app increments. The one exception is `share`, which happens inside
// the phone's share sheet where the server cannot see it; the app reports it
// once a day and the server records that it was reported, nothing more.
//
// A claim is a reward claim like any other (§ C5b): the ledger key is
// `task:{user}:{IST date}:{task id}`, so one task pays once a day however
// often or from however many phones it is asked for.

import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { getConfigValue } from '../economy/index.js';
import { freeCoinsConfig, grant, istDate } from './rewards.service.js';

const TASK_KINDS = ['watch_minutes', 'chat', 'gifts', 'follows', 'share'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

const tasksSchema = z
  .object({
    tasks: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9_]{1,32}$/),
            kind: z.enum(TASK_KINDS),
            target: z.number().int().min(1).max(10_000),
            coins: z.number().int().min(0).max(100_000),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

export type TaskSpec = z.infer<typeof tasksSchema>['tasks'][number];

export interface DailyTask extends TaskSpec {
  progress: number;
  claimed: boolean;
}

export interface DailyTasks {
  /** The IST day these count against. */
  day: string;
  tasks: DailyTask[];
}

async function tasksConfig(): Promise<TaskSpec[]> {
  const parsed = tasksSchema.safeParse(await getConfigValue('daily_tasks'));
  if (!parsed.success) {
    logger.error('app_config.daily_tasks is invalid; no tasks offered', {
      issues: parsed.error.issues.length,
    });
    return [];
  }
  // A task with no coins is switched off, not shown as a task that pays nothing.
  return parsed.data.tasks.filter((task) => task.coins > 0);
}

/** Midnight IST of a YYYY-MM-DD day, as an instant. */
function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

async function progressFor(userId: string, day: string): Promise<Record<TaskKind, number>> {
  const since = istDayStart(day);
  const watch = await freeCoinsConfig();
  const { rows } = await pool.query<{
    watch_intervals: string;
    chat: string;
    gifts: string;
    follows: string;
    shared: boolean;
  }>(
    `SELECT (SELECT count(*) FROM reward_claims
              WHERE user_id = $1 AND kind = 'watch' AND day_ist = $2::date) AS watch_intervals,
            (SELECT count(*) FROM room_messages
              WHERE user_id = $1 AND created_at >= $3 AND verdict <> 'blocked') AS chat,
            (SELECT count(*) FROM gift_sends
              WHERE sender_user_id = $1 AND created_at >= $3) AS gifts,
            (SELECT count(*) FROM follows
              WHERE follower_user_id = $1 AND created_at >= $3) AS follows,
            EXISTS (SELECT 1 FROM task_events
                     WHERE user_id = $1 AND kind = 'share' AND day_ist = $2::date) AS shared`,
    [userId, day, since],
  );
  const row = rows[0];
  return {
    watch_minutes: Number(row.watch_intervals) * watch.watch.minutes,
    chat: Number(row.chat),
    gifts: Number(row.gifts),
    follows: Number(row.follows),
    share: row.shared ? 1 : 0,
  };
}

export async function dailyTasks(userId: string, day: string = istDate()): Promise<DailyTasks> {
  const specs = await tasksConfig();
  if (specs.length === 0) return { day, tasks: [] };

  const [progress, claims] = await Promise.all([
    progressFor(userId, day),
    pool.query<{ claim_key: string }>(
      `SELECT claim_key FROM reward_claims WHERE user_id = $1 AND kind = 'task' AND day_ist = $2::date`,
      [userId, day],
    ),
  ]);
  const claimed = new Set(claims.rows.map((r) => r.claim_key));

  return {
    day,
    tasks: specs.map((spec) => ({
      ...spec,
      progress: Math.min(spec.target, progress[spec.kind]),
      claimed: claimed.has(claimKeyFor(userId, day, spec.id)),
    })),
  };
}

function claimKeyFor(userId: string, day: string, taskId: string): string {
  return `task:${userId}:${day}:${taskId}`;
}

export async function claimTask(
  userId: string,
  taskId: string,
  day: string = istDate(),
): Promise<{ coins: number; alreadyClaimed: boolean }> {
  const spec = (await tasksConfig()).find((task) => task.id === taskId);
  if (!spec) throw new AppError('REWARD_UNAVAILABLE', 'This task is not available right now', 409);

  const claimKey = claimKeyFor(userId, day, spec.id);
  const existing = await pool.query<{ coins: string }>(
    'SELECT coins FROM reward_claims WHERE claim_key = $1',
    [claimKey],
  );
  if (existing.rows[0]) return { coins: Number(existing.rows[0].coins), alreadyClaimed: true };

  const progress = await progressFor(userId, day);
  if (progress[spec.kind] < spec.target) {
    throw new AppError('REWARD_NOT_EARNED', 'This task is not finished yet', 409, {
      progress: progress[spec.kind],
      target: spec.target,
    });
  }

  const result = await grant({ userId, kind: 'task', claimKey, coins: spec.coins, dayIst: day });
  return { coins: result.coins, alreadyClaimed: result.replayed };
}

/** The app says the share sheet completed. Recorded once a day; nothing is paid here. */
export async function recordShare(userId: string, day: string = istDate()): Promise<void> {
  await pool.query(
    `INSERT INTO task_events (user_id, kind, day_ist) VALUES ($1, 'share', $2::date)
     ON CONFLICT DO NOTHING`,
    [userId, day],
  );
}
