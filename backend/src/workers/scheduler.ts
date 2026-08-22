// A small scheduler for the workers process.
//
// No cron dependency: the requirement is "run this every N ms" and "run this
// once a day at a given IST time", both of which are a few lines each.
//
// Two properties matter more than the scheduling itself:
//
//   1. **Only one instance runs a given job.** Enforced with a Postgres advisory
//      lock, so two workers behind a load balancer cannot both run the nightly
//      reconciliation or both drain the outbox row-by-row.
//   2. **Every execution is recorded.** A job that silently stops is invisible
//      otherwise — nothing errors, nothing alerts, the outbox just stops
//      draining.

import { createHash } from 'crypto';
import { pool } from '../infra/db.js';
import { logger } from '../infra/logger.js';
import { alert } from '../infra/alerts.js';

export type JobResult = Record<string, unknown> | void;

export interface Job {
  name: string;
  run: () => Promise<JobResult>;
  /** Repeat every N milliseconds. */
  everyMs?: number;
  /** Or run once a day at this IST time, 'HH:MM'. */
  dailyAtIst?: string;
  /** Page rather than warn when this job fails. */
  pageOnFailure?: boolean;
}

/** Advisory locks are keyed by bigint, so the job name is hashed into one. */
function lockKey(job: string): bigint {
  const hash = createHash('sha256').update(job).digest();
  // Signed 64-bit: take 63 bits so the value never goes negative.
  return hash.readBigUInt64BE(0) & 0x7fffffffffffffffn;
}

/**
 * Runs `fn` only if this instance can take the lock.
 *
 * The lock is session-scoped, so it needs a dedicated client held for the whole
 * job — and it is released automatically if the process dies, which is exactly
 * what should happen.
 */
async function withJobLock<T>(job: string, fn: () => Promise<T>): Promise<T | 'skipped'> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [lockKey(job).toString()],
    );
    if (!rows[0].locked) return 'skipped';

    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey(job).toString()]);
    }
  } finally {
    client.release();
  }
}

async function recordStart(job: string): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO job_runs (job, status) VALUES ($1, 'running') RETURNING id",
    [job],
  );
  return Number(rows[0].id);
}

async function recordFinish(
  id: number,
  status: 'success' | 'failed' | 'skipped',
  startedAt: number,
  result?: JobResult,
  error?: unknown,
): Promise<void> {
  await pool.query(
    'UPDATE job_runs SET status = $2, finished_at = now(), duration_ms = $3,' +
      ' result = $4::jsonb, error = $5 WHERE id = $1',
    [
      id,
      status,
      Date.now() - startedAt,
      result ? JSON.stringify(result) : null,
      error ? String(error instanceof Error ? error.message : error).slice(0, 2000) : null,
    ],
  );
}

export async function runJobOnce(job: Job): Promise<void> {
  const startedAt = Date.now();
  let runId: number | undefined;

  try {
    const outcome = await withJobLock(job.name, async () => {
      runId = await recordStart(job.name);
      return job.run();
    });

    if (outcome === 'skipped') {
      // Another instance holds the lock. Normal, and not worth a log line every
      // tick — only interesting if it never resolves.
      return;
    }

    await recordFinish(runId!, 'success', startedAt, outcome ?? undefined);
  } catch (err) {
    logger.error(`job "${job.name}" failed`, err);
    if (runId) await recordFinish(runId, 'failed', startedAt, undefined, err).catch(() => undefined);

    await alert({
      severity: job.pageOnFailure ? 'page' : 'warn',
      key: `job:${job.name}`,
      title: `Scheduled job "${job.name}" failed`,
      detail: { job: job.name, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

/** IST is UTC+5:30 with no daylight saving, so the offset is a constant. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function msUntilNextIst(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);

  const targetIst = new Date(nowIst);
  targetIst.setUTCHours(hours, minutes, 0, 0);
  if (targetIst.getTime() <= nowIst.getTime()) {
    targetIst.setUTCDate(targetIst.getUTCDate() + 1);
  }

  return targetIst.getTime() - nowIst.getTime();
}

export class Scheduler {
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;

  start(jobs: Job[]): void {
    for (const job of jobs) {
      if (job.everyMs) {
        // setTimeout chained rather than setInterval: a slow run must not
        // overlap the next tick, which for the outbox shipper would mean two
        // copies competing for the same rows.
        const tick = async () => {
          if (this.stopped) return;
          await runJobOnce(job);
          if (!this.stopped) this.timers.push(setTimeout(tick, job.everyMs!));
        };
        this.timers.push(setTimeout(tick, 0));
        logger.info('job scheduled', { job: job.name, every_ms: job.everyMs });
      } else if (job.dailyAtIst) {
        const schedule = () => {
          if (this.stopped) return;
          const delay = msUntilNextIst(job.dailyAtIst!);
          this.timers.push(
            setTimeout(async () => {
              await runJobOnce(job);
              schedule();
            }, delay),
          );
        };
        schedule();
        logger.info('job scheduled', { job: job.name, daily_at_ist: job.dailyAtIst });
      }
    }
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}
