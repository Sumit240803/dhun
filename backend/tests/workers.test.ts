import { randomUUID } from 'crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { pool } from '../src/infra/db.js';
import { freeCoinGrantLegs, postTransaction, ECONOMY } from '../src/modules/economy/index.js';
import { shipOutboxBatch, outboxShipperJob } from '../src/workers/jobs/outboxShipper.js';
import {
  consecutiveCleanDays,
  runReconciliation,
} from '../src/workers/jobs/reconciliation.js';
import { purgeIdempotencyBodiesJob, reapStuckJobRunsJob } from '../src/workers/jobs/retention.js';
import { runJobOnce } from '../src/workers/scheduler.js';
import { setEventPublisher, type OutboxEventRecord } from '../src/workers/publisher.js';
import { closePool, createUser, resetLedger } from './helpers.js';

const RATES = {
  faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
  pointsPerRupee: ECONOMY.pointsPerRupee,
};

/** Captures what was published, and can be told to fail. */
function recordingPublisher() {
  const published: OutboxEventRecord[] = [];
  let failNext = false;
  setEventPublisher({
    name: 'test',
    async publish(events) {
      if (failNext) throw new Error('publisher is down');
      published.push(...events);
    },
  });
  return {
    published,
    fail: (v: boolean) => {
      failNext = v;
    },
  };
}

async function grantCoins(userId: string, coins: number, eventType = 'free_coins_earned') {
  return postTransaction({
    txnType: 'free_coin_grant',
    idempotencyKey: uuidv7(),
    identity: { source: 'signup' },
    rates: RATES,
    legs: freeCoinGrantLegs({ userId, coins }),
    events: [{ eventType, partitionKey: userId, payload: { user_id: userId, coins } }],
  });
}

beforeEach(async () => {
  await resetLedger();
  await pool.query('DELETE FROM reconciliation_checks');
  await pool.query('DELETE FROM job_runs');
});
afterAll(closePool);

describe('outbox shipper', () => {
  it('publishes events written by a ledger transaction', async () => {
    const publisher = recordingPublisher();
    const user = await createUser();
    await grantCoins(user, 500);

    const result = await shipOutboxBatch();

    expect(result).toEqual({ published: 1, failed: 0 });
    expect(publisher.published[0]).toMatchObject({
      eventType: 'free_coins_earned',
      partitionKey: user,
    });
    // Money events carry their transaction id, so an analytics row can always be
    // traced back to the ledger entry that caused it.
    expect(publisher.published[0].txnId).toBeTruthy();
  });

  it('never publishes the same event twice', async () => {
    const publisher = recordingPublisher();
    const user = await createUser();
    await grantCoins(user, 500);

    await shipOutboxBatch();
    const second = await shipOutboxBatch();

    expect(second.published).toBe(0);
    expect(publisher.published).toHaveLength(1);
  });

  it('preserves order within a partition key', async () => {
    const publisher = recordingPublisher();
    const user = await createUser();
    for (const n of [1, 2, 3, 4, 5]) await grantCoins(user, n * 100);

    await shipOutboxBatch();

    const coins = publisher.published.map((e) => (e.payload as { coins: number }).coins);
    expect(coins).toEqual([100, 200, 300, 400, 500]);
  });

  it('leaves events unpublished when the publisher fails, and counts the attempt', async () => {
    const publisher = recordingPublisher();
    const user = await createUser();
    await grantCoins(user, 500);

    publisher.fail(true);
    const failed = await shipOutboxBatch();
    expect(failed).toEqual({ published: 0, failed: 1 });

    const { rows } = await pool.query('SELECT attempts, last_error, published_at FROM outbox');
    expect(rows[0].published_at).toBeNull();
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].last_error).toContain('publisher is down');

    // Recovers on the next pass rather than losing the event.
    publisher.fail(false);
    expect(await shipOutboxBatch()).toEqual({ published: 1, failed: 0 });
  });

  it('records a run in job_runs', async () => {
    recordingPublisher();
    const user = await createUser();
    await grantCoins(user, 500);

    await runJobOnce(outboxShipperJob);

    const { rows } = await pool.query(
      "SELECT status, result FROM job_runs WHERE job = 'outbox_shipper' ORDER BY id DESC LIMIT 1",
    );
    expect(rows[0].status).toBe('success');
    expect(rows[0].result).toMatchObject({ published: 1 });
  });
});

describe('reconciliation', () => {
  it('passes on a clean ledger', async () => {
    recordingPublisher();
    const user = await createUser();
    await grantCoins(user, 500);
    await shipOutboxBatch();

    const outcomes = await runReconciliation();

    expect(outcomes.filter((o) => o.status === 'fail')).toEqual([]);
    expect(outcomes.map((o) => o.name)).toContain('balance_cache_matches_entries');
    expect(outcomes.map((o) => o.name)).toContain('transactions_balance_per_unit');
  });

  it('detects a balance cache that has drifted from the entries', async () => {
    const user = await createUser();
    await grantCoins(user, 500);

    // Simulates the failure the check exists for: a write path that updated the
    // cache without writing entries, or vice versa.
    await pool.query(
      "UPDATE account_balances SET balance = balance + 999 WHERE account_id IN" +
        " (SELECT id FROM ledger_accounts WHERE code = 'user_coins' AND scope_id = $1)",
      [user],
    );

    const outcomes = await runReconciliation();
    const check = outcomes.find((o) => o.name === 'balance_cache_matches_entries');

    expect(check?.status).toBe('fail');
    expect(check?.mismatchCount).toBe(1);
  });

  it('detects an outbox that has stalled', async () => {
    const user = await createUser();
    await grantCoins(user, 500);
    await pool.query("UPDATE outbox SET created_at = now() - interval '1 hour'");

    const outcomes = await runReconciliation();
    const check = outcomes.find((o) => o.name === 'outbox_is_draining');

    // A silently stopped shipper is otherwise invisible: nothing errors, the API
    // keeps working, and analytics simply go quiet.
    expect(check?.status).toBe('fail');
  });

  it('detects a purchase stuck between payment and credit', async () => {
    const user = await createUser();
    await pool.query(
      'INSERT INTO purchases (id, user_id, pack_id, channel, provider, provider_txn_id,' +
        " amount_paise, coins_granted, gems_granted, status, created_at)" +
        " VALUES ($1,$2,'small_99','iap','google_play',$3,9900,5445,1305,'pending'," +
        " now() - interval '2 hours')",
      [randomUUID(), user, `stub-${randomUUID()}`],
    );

    const outcomes = await runReconciliation();
    const check = outcomes.find((o) => o.name === 'purchases_match_ledger');

    expect(check?.status).toBe('fail');
    expect(check?.detail).toMatchObject({ stuckPending: 1 });
  });

  it('stores each check so the beta exit criterion is a query', async () => {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO job_runs (job, status) VALUES ('nightly_reconciliation','running') RETURNING id",
    );
    const runId = Number(rows[0].id);

    await runReconciliation(runId);

    const stored = await pool.query(
      'SELECT check_name, status FROM reconciliation_checks WHERE run_id = $1',
      [runId],
    );
    expect(stored.rows.length).toBeGreaterThanOrEqual(6);
    // "Ledger zero mismatches, 7 consecutive days" — one query, not archaeology.
    expect(await consecutiveCleanDays()).toBe(1);
  });
});

describe('retention', () => {
  it('drops cached response bodies past 7 days but keeps the key', async () => {
    const user = await createUser();
    const key = uuidv7();
    await postTransaction({
      txnType: 'free_coin_grant',
      idempotencyKey: key,
      identity: { source: 'signup' },
      rates: RATES,
      legs: freeCoinGrantLegs({ userId: user, coins: 500 }),
      response: { granted: 500 },
    });

    await pool.query("UPDATE ledger_txns SET created_at = now() - interval '8 days'");
    await runJobOnce(purgeIdempotencyBodiesJob);

    const { rows } = await pool.query(
      'SELECT idempotency_key, response_body FROM ledger_txns WHERE idempotency_key = $1',
      [key],
    );
    // The key stays forever — it is what stops a stray retry double-applying
    // years later. Only the payload is dropped.
    expect(rows[0].idempotency_key).toBe(key);
    expect(rows[0].response_body).toBeNull();
  });

  it('marks a job that died mid-run', async () => {
    await pool.query(
      "INSERT INTO job_runs (job, status, started_at)" +
        " VALUES ('outbox_shipper','running', now() - interval '3 hours')",
    );

    await runJobOnce(reapStuckJobRunsJob);

    const { rows } = await pool.query(
      "SELECT status, error FROM job_runs WHERE job = 'outbox_shipper' ORDER BY id LIMIT 1",
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toContain('worker exited');
  });
});

describe('job locking', () => {
  it('lets only one instance run a job at a time', async () => {
    recordingPublisher();
    const user = await createUser();
    await grantCoins(user, 500);

    let concurrent = 0;
    let maxConcurrent = 0;

    const job = {
      name: 'lock_test',
      run: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 120));
        concurrent -= 1;
        return { ok: true };
      },
    };

    // Two workers behind a load balancer must not both run the nightly
    // reconciliation, or both drain the outbox row by row.
    await Promise.all([runJobOnce(job), runJobOnce(job), runJobOnce(job)]);

    expect(maxConcurrent).toBe(1);
  });
});
