// The analytics sink's two jobs (migration 039, build-plan M21 slice 5).
//
//   analytics_partitions  00:15 IST  create the next week's day partitions,
//                                    drop the ones past retention
//   analytics_export      02:15 IST  yesterday's rows → the PRIVATE archive
//                                    bucket, gzipped NDJSON, one object a day
//
// Order matters: the export runs long before the drop could reach yesterday
// (retention is 90 days), so a day always leaves Postgres only after it has
// been archived — or after the export has failed for 89 days running, which
// the failed-job alert and the daily summary would both have reported.

import { gzipSync } from 'zlib';
import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { getConfigValue } from '../../modules/economy/index.js';
import { isArchiveConfigured, putArchiveObject } from '../../modules/media/index.js';
import type { Job } from '../scheduler.js';

const configSchema = z
  .object({
    retentionDays: z.number().int().min(7).max(365),
    partitionsAhead: z.number().int().min(1).max(30),
  })
  .strict();

async function analyticsConfig(): Promise<z.infer<typeof configSchema>> {
  const parsed = configSchema.safeParse(await getConfigValue('analytics'));
  return parsed.success ? parsed.data : { retentionDays: 90, partitionsAhead: 7 };
}

export const analyticsPartitionsJob: Job = {
  name: 'analytics_partitions',
  dailyAtIst: '00:15',
  run: async () => {
    const { retentionDays, partitionsAhead } = await analyticsConfig();
    const created = await pool.query<{ n: number }>('SELECT analytics_ensure_partitions(1, $1) AS n', [
      partitionsAhead,
    ]);
    const dropped = await pool.query<{ n: number }>('SELECT analytics_drop_partitions($1) AS n', [retentionDays]);
    // A row in the default partition means events arrived for a day that had
    // no partition — the job stopped for a while. Reported, not fatal.
    const stray = await pool.query<{ n: string }>('SELECT count(*)::bigint AS n FROM analytics_events_default');
    return { created: created.rows[0].n, dropped: dropped.rows[0].n, inDefault: Number(stray.rows[0].n) };
  },
};

/** The IST calendar day before today, YYYY-MM-DD. */
function yesterdayIst(now = Date.now()): string {
  return new Date(now + 5.5 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
}

const PAGE = 5_000;

/**
 * One IST day as gzipped NDJSON, read in keyset pages so a large day never
 * holds the whole result in one query. Exported for the tests.
 */
export async function exportDay(day: string): Promise<{ key: string; rows: number; bytes: number }> {
  const lines: string[] = [];
  let after: { at: Date; id: string } | null = null;

  for (;;) {
    const result = await pool.query<Record<string, unknown>>(
      `SELECT id, occurred_at, received_at, event, user_id, device_id, session_id,
              app_version, platform, app_update, props
         FROM analytics_events
        WHERE occurred_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND occurred_at <  (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
          AND ($2::timestamptz IS NULL OR (occurred_at, id) > ($2::timestamptz, $3::uuid))
        ORDER BY occurred_at, id
        LIMIT ${PAGE}`,
      [day, after?.at ?? null, after?.id ?? null],
    );
    const rows = result.rows;
    for (const row of rows) lines.push(JSON.stringify(row));
    if (rows.length < PAGE) break;
    const last: Record<string, unknown> = rows[rows.length - 1];
    after = { at: last.occurred_at as Date, id: last.id as string };
  }

  const [y, m, d] = day.split('-');
  const key = `analytics/${y}/${m}/${d}.ndjson.gz`;
  const body = gzipSync(Buffer.from(lines.length ? `${lines.join('\n')}\n` : ''));
  await putArchiveObject({ key, body, contentType: 'application/x-ndjson', contentEncoding: 'gzip' });
  return { key, rows: lines.length, bytes: body.length };
}

export const analyticsExportJob: Job = {
  name: 'analytics_export',
  dailyAtIst: '02:15',
  run: async () => {
    if (!isArchiveConfigured()) {
      // Not a failure: until ANALYTICS_BUCKET exists, Postgres keeps 90 days.
      return { skipped: 'ANALYTICS_BUCKET is not configured' };
    }
    return exportDay(yesterdayIst());
  },
};
