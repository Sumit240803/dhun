// The workers process.
//
// Third of the three processes (API · realtime gateway · workers). It runs
// everything scheduled: shipping the outbox, the nightly reconciliation, and
// retention purges. Payout batches, TDS accrual and commission recalc join it
// in M8.
//
// Deliberately separate from the API. A payout batch or a reconciliation sweep
// is spiky and long-running, and it must never be able to stall a room join or
// hold a connection a gifting request needs.
//
//   npm run worker

import pg from 'pg';
import { config } from '../config/index.js';
import { pool } from '../infra/db.js';
import { logger } from '../infra/logger.js';
import { outboxShipperJob, shipOutboxBatch } from './jobs/outboxShipper.js';
import { reconciliationJob } from './jobs/reconciliation.js';
import {
  purgeIdempotencyBodiesJob,
  purgeOtpChallengesJob,
  purgeRefreshTokensJob,
  purgeShippedOutboxJob,
  reapStuckJobRunsJob,
} from './jobs/retention.js';
import { Job, Scheduler, runJobOnce } from './scheduler.js';

export const JOBS: Job[] = [
  outboxShipperJob,
  reconciliationJob,
  purgeIdempotencyBodiesJob,
  purgeShippedOutboxJob,
  purgeOtpChallengesJob,
  purgeRefreshTokensJob,
  reapStuckJobRunsJob,
];

/**
 * Wakes the shipper the moment an event lands.
 *
 * LISTEN holds its connection for as long as it is listening, so this takes a
 * dedicated client rather than one from the pool — a pooled connection would be
 * handed to someone else and the subscription would vanish.
 *
 * Notifications can be missed (a reconnect, a restart), which is exactly why the
 * shipper also polls. This makes the common case immediate; the poll makes it
 * correct.
 */
async function listenForOutbox(onWake: () => void): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  await client.query('LISTEN outbox_new');

  client.on('notification', () => onWake());
  client.on('error', (err) => logger.error('outbox listener error', err));

  logger.info('listening for outbox notifications');
  return client;
}

async function main() {
  await pool.query('SELECT 1');
  logger.info('workers starting', { env: config.nodeEnv, jobs: JOBS.map((j) => j.name) });

  const scheduler = new Scheduler();
  scheduler.start(JOBS);

  // Coalesce wakeups: a burst of gifts should trigger one drain, not fifty.
  let draining = false;
  const wake = () => {
    if (draining) return;
    draining = true;
    setTimeout(async () => {
      try {
        await shipOutboxBatch();
      } catch (err) {
        logger.error('outbox drain on notify failed', err);
      } finally {
        draining = false;
      }
    }, 25);
  };

  const listener = await listenForOutbox(wake);

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('workers shutting down', { signal });

    scheduler.stop();
    try {
      await listener.end();
      // One last drain, so a graceful stop never strands events that are already
      // committed and merely waiting.
      await shipOutboxBatch();
      await pool.end();
    } catch (err) {
      logger.error('error during worker shutdown', err);
    }
    process.exit(exitCode);
  };

  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception in workers — shutting down', err);
    void shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection in workers', reason);
  });
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

/** Runs one job by name and exits. For manual operation and for cron-style hosts. */
export async function runOnce(jobName: string): Promise<void> {
  const job = JOBS.find((j) => j.name === jobName);
  if (!job) throw new Error(`Unknown job "${jobName}". Known: ${JOBS.map((j) => j.name).join(', ')}`);

  await runJobOnce(job);
  await pool.end();
}

const invokedDirectly = process.argv[1]?.includes('workers');
if (invokedDirectly) {
  const oneShot = process.argv.indexOf('--run');
  const promise = oneShot > -1 ? runOnce(process.argv[oneShot + 1]) : main();

  promise.catch((err) => {
    logger.error('workers failed to start', err);
    process.exit(1);
  });
}
