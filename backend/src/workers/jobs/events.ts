// The event log's two jobs: forget old rows, and notice a burst.
//
// Retention is per level (app_config.event_log.retentionDays). Errors are kept
// longest — they are what a post-mortem reads — and info rows, the audit
// trail, are plentiful and go first. The table has no other way to lose a row:
// UPDATE is refused by trigger and the app role cannot UPDATE at all.
//
// The burst check is the difference between a log and a monitor. A log is
// read when someone goes looking; a monitor finds them. Every five minutes it
// counts errors in the window, by fingerprint, and raises an alert when one
// problem repeats past the threshold or the total does. The alert goes
// through infra/alerts.ts, so it reaches whatever transport is wired, and it
// is itself recorded, so the screen shows when the alarm went off.

import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { alert } from '../../infra/alerts.js';
import { getConfigValue } from '../../modules/economy/index.js';
import type { Job } from '../scheduler.js';

const configSchema = z
  .object({
    retentionDays: z
      .object({
        info: z.number().int().min(1).max(365),
        warn: z.number().int().min(1).max(365),
        error: z.number().int().min(1).max(730),
      })
      .strict(),
    burst: z
      .object({
        windowMinutes: z.number().int().min(1).max(60),
        sameErrorToAlert: z.number().int().min(2).max(10_000),
        totalErrorsToAlert: z.number().int().min(2).max(100_000),
      })
      .strict(),
  })
  .strict();

const DEFAULTS: z.infer<typeof configSchema> = {
  retentionDays: { info: 30, warn: 60, error: 90 },
  burst: { windowMinutes: 5, sameErrorToAlert: 20, totalErrorsToAlert: 60 },
};

export async function eventLogConfig(): Promise<z.infer<typeof configSchema>> {
  const parsed = configSchema.safeParse(await getConfigValue('event_log'));
  return parsed.success ? parsed.data : DEFAULTS;
}

/** Deletes by age and level, in batches, so a long-neglected table never locks for minutes. */
export const purgeSystemEventsJob: Job = {
  name: 'purge_system_events',
  dailyAtIst: '04:45',
  run: async () => {
    const { retentionDays } = await eventLogConfig();
    const deleted: Record<string, number> = {};

    for (const level of ['info', 'warn', 'error'] as const) {
      let total = 0;
      for (;;) {
        const { rowCount } = await pool.query(
          `DELETE FROM system_events
            WHERE id IN (
              SELECT id FROM system_events
               WHERE level = $1 AND occurred_at < now() - make_interval(days => $2)
               LIMIT 5000
            )`,
          [level, retentionDays[level]],
        );
        total += rowCount ?? 0;
        if (!rowCount || rowCount < 5000) break;
      }
      if (total) deleted[level] = total;
    }

    return Object.keys(deleted).length ? { deleted } : undefined;
  },
};

interface BurstRow {
  fingerprint: string;
  event: string;
  code: string | null;
  message: string | null;
  count: string;
}

/**
 * Alerts when errors cluster.
 *
 * The alert key carries the fingerprint, so one bug repeating produces one
 * stream of alerts a transport can deduplicate, and two different bugs are
 * two alerts rather than one blended "errors are up".
 */
export const errorBurstCheckJob: Job = {
  name: 'error_burst_check',
  everyMs: 5 * 60_000,
  run: async () => {
    const { burst } = await eventLogConfig();

    const { rows } = await pool.query<BurstRow>(
      `SELECT fingerprint,
              (array_agg(event ORDER BY occurred_at DESC))[1] AS event,
              (array_agg(code ORDER BY occurred_at DESC))[1] AS code,
              (array_agg(message ORDER BY occurred_at DESC))[1] AS message,
              count(*)::bigint AS count
         FROM system_events
        WHERE level = 'error'
          AND occurred_at > now() - make_interval(mins => $1)
        GROUP BY fingerprint
        ORDER BY count DESC`,
      [burst.windowMinutes],
    );

    const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
    const bursts = rows.filter((row) => Number(row.count) >= burst.sameErrorToAlert);

    for (const row of bursts) {
      await alert({
        severity: 'page',
        key: `error_burst:${row.fingerprint}`,
        title: `${row.event} ×${row.count} in ${burst.windowMinutes} min`,
        detail: {
          fingerprint: row.fingerprint,
          event: row.event,
          code: row.code,
          message: row.message,
          count: Number(row.count),
          window_minutes: burst.windowMinutes,
        },
      });
    }

    if (total >= burst.totalErrorsToAlert) {
      await alert({
        severity: 'page',
        key: 'error_burst:total',
        title: `${total} errors in ${burst.windowMinutes} min`,
        detail: { total, distinct: rows.length, window_minutes: burst.windowMinutes },
      });
    }

    return total ? { errors: total, distinct: rows.length, alerted: bursts.length } : undefined;
  },
};
