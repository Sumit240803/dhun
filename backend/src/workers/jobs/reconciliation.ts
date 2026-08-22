// Nightly reconciliation. Day-1 non-negotiable #1.
//
// payout-operations-v1 lists six checks and one instruction: "chhota mismatch
// bade bug ka symptom hota hai. Ignore mat karna." So every check that fails
// pages, and the tolerance is zero — not "small differences are fine".
//
// Results are written per check, per day, because the closed-beta exit criterion
// is "ledger zero mismatches, 7 consecutive days" and that should be a query.

import { PoolClient } from 'pg';
import { pool, withTransaction } from '../../infra/db.js';
import { alert } from '../../infra/alerts.js';
import { logger } from '../../infra/logger.js';
import type { Job } from '../scheduler.js';

export interface CheckOutcome {
  name: string;
  status: 'pass' | 'fail' | 'skipped';
  mismatchCount: number;
  detail?: Record<string, unknown>;
}

type Check = {
  name: string;
  description: string;
  run: (client: PoolClient) => Promise<CheckOutcome>;
};

function pass(name: string, detail?: Record<string, unknown>): CheckOutcome {
  return { name, status: 'pass', mismatchCount: 0, detail };
}

function fail(name: string, count: number, detail?: Record<string, unknown>): CheckOutcome {
  return { name, status: 'fail', mismatchCount: count, detail };
}

const CHECKS: Check[] = [
  {
    name: 'balance_cache_matches_entries',
    description: 'E1 — every cached balance equals the sum of its ledger entries',
    run: async (client) => {
      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*) FROM (' +
          '  SELECT b.account_id' +
          '    FROM account_balances b' +
          '    LEFT JOIN ledger_entries e ON e.account_id = b.account_id' +
          '   GROUP BY b.account_id, b.balance' +
          '  HAVING b.balance <> COALESCE(SUM(e.amount), 0)' +
          ') drifted',
      );
      const count = Number(rows[0].count);
      // The cache is a cache; the entries are the truth. Any drift means a write
      // path updated one without the other.
      return count === 0
        ? pass('balance_cache_matches_entries')
        : fail('balance_cache_matches_entries', count, { driftedAccounts: count });
    },
  },
  {
    name: 'transactions_balance_per_unit',
    description: 'E2 — every transaction sums to zero, per unit',
    run: async (client) => {
      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*) FROM (' +
          '  SELECT txn_id, unit FROM ledger_entries' +
          '   GROUP BY txn_id, unit HAVING SUM(amount) <> 0' +
          ') unbalanced',
      );
      const count = Number(rows[0].count);
      // A deferred constraint trigger makes this impossible at write time, so a
      // failure here means the constraint was dropped or bypassed.
      return count === 0
        ? pass('transactions_balance_per_unit')
        : fail('transactions_balance_per_unit', count, { unbalanced: count });
    },
  },
  {
    name: 'coin_float_reconciles',
    description: 'E3 — coins issued minus spent equals the outstanding liability',
    run: async (client) => {
      const { rows } = await client.query<{ total: string | null }>(
        "SELECT SUM(amount) AS total FROM ledger_entries WHERE unit = 'coin'",
      );
      const total = Number(rows[0].total ?? 0);
      // Structural in this model — the float account is the counterparty to every
      // user balance, so the sum is zero by construction. Verified anyway: it
      // costs one query and it is the check that proves the model still holds.
      return total === 0
        ? pass('coin_float_reconciles', { note: 'structural' })
        : fail('coin_float_reconciles', 1, { coinUnitSum: total });
    },
  },
  {
    name: 'points_match_gift_payout_rate',
    description: 'E6 — points issued equal gift value times the rate frozen on the txn',
    run: async (client) => {
      // Recomputed with the SAME integer floor expression the ledger used. A
      // different rounding rule here would invent mismatches that are not real.
      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*) FROM (' +
          "  SELECT t.id," +
          "         SUM(CASE WHEN a.code = 'user_coins' THEN -e.amount ELSE 0 END) AS coins," +
          "         SUM(CASE WHEN a.code = 'host_points_held' THEN e.amount ELSE 0 END) AS points," +
          "         MAX((t.rates->>'payoutRateBp')::numeric) AS rate_bp" +
          '    FROM ledger_txns t' +
          '    JOIN ledger_entries e ON e.txn_id = t.id' +
          '    JOIN ledger_accounts a ON a.id = e.account_id' +
          "   WHERE t.txn_type = 'gift_send'" +
          '   GROUP BY t.id' +
          ') g' +
          ' WHERE g.rate_bp IS NOT NULL' +
          '   AND g.points <> floor(g.coins * g.rate_bp / 10000)',
      );
      const count = Number(rows[0].count);
      return count === 0
        ? pass('points_match_gift_payout_rate')
        : fail('points_match_gift_payout_rate', count, { mismatchedGifts: count });
    },
  },
  {
    name: 'purchases_match_ledger',
    description: 'E5 — every credited purchase has a matching ledger transaction',
    run: async (client) => {
      const { rows } = await client.query<{ orphaned: string; stuck: string }>(
        'SELECT' +
          "  count(*) FILTER (WHERE status = 'credited' AND ledger_txn_id IS NULL) AS orphaned," +
          "  count(*) FILTER (WHERE status = 'pending'" +
          "                   AND created_at < now() - interval '1 hour') AS stuck" +
          ' FROM purchases',
      );
      const orphaned = Number(rows[0].orphaned);
      // A purchase stuck at pending means the process died between taking the
      // money and crediting the coins. Recoverable — the ledger is idempotent —
      // but somebody has to be told.
      const stuck = Number(rows[0].stuck);

      return orphaned + stuck === 0
        ? pass('purchases_match_ledger')
        : fail('purchases_match_ledger', orphaned + stuck, { orphaned, stuckPending: stuck });
    },
  },
  {
    name: 'no_negative_user_balances',
    description: 'No user or host account has gone negative',
    run: async (client) => {
      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*) FROM account_balances WHERE balance < 0',
      );
      const count = Number(rows[0].count);
      return count === 0
        ? pass('no_negative_user_balances')
        : fail('no_negative_user_balances', count, { negativeAccounts: count });
    },
  },
  {
    name: 'outbox_is_draining',
    description: 'No event has been sitting unpublished for too long',
    run: async (client) => {
      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*) FROM outbox' +
          " WHERE published_at IS NULL AND created_at < now() - interval '15 minutes'",
      );
      const count = Number(rows[0].count);
      // A silently stopped shipper is invisible otherwise: nothing errors, the
      // API keeps working, and analytics simply go quiet.
      return count === 0
        ? pass('outbox_is_draining')
        : fail('outbox_is_draining', count, { stalledEvents: count });
    },
  },
];

// E4 (payouts versus the bank statement) arrives with M8 — there are no payouts
// to reconcile yet, and a check that always passes because it has nothing to
// look at is worse than an absent one.

export async function runReconciliation(runId?: number): Promise<CheckOutcome[]> {
  const outcomes: CheckOutcome[] = [];

  for (const check of CHECKS) {
    try {
      const outcome = await withTransaction((client) => check.run(client));
      outcomes.push(outcome);
    } catch (err) {
      logger.error(`reconciliation check "${check.name}" errored`, err);
      outcomes.push({
        name: check.name,
        status: 'fail',
        mismatchCount: 1,
        detail: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  if (runId) {
    for (const o of outcomes) {
      await pool.query(
        'INSERT INTO reconciliation_checks (run_id, check_name, status, mismatch_count, detail)' +
          ' VALUES ($1,$2,$3,$4,$5::jsonb)',
        [runId, o.name, o.status, o.mismatchCount, o.detail ? JSON.stringify(o.detail) : null],
      );
    }
  }

  const failures = outcomes.filter((o) => o.status === 'fail');
  if (failures.length) {
    // Tolerance is zero, deliberately. A one-rupee mismatch is a bug that has
    // not finished happening yet.
    await alert({
      severity: 'page',
      key: 'reconciliation:mismatch',
      title: `Ledger reconciliation FAILED — ${failures.length} check(s) mismatched`,
      detail: {
        failed: failures.map((f) => ({ check: f.name, count: f.mismatchCount, ...f.detail })),
      },
    });
  }

  return outcomes;
}

export const reconciliationJob: Job = {
  name: 'nightly_reconciliation',
  // 03:00 IST — after the 8pm–2am peak has drained, before anyone is awake to be
  // confused by a page.
  dailyAtIst: '03:00',
  pageOnFailure: true,
  run: async () => {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM job_runs WHERE job = $1 ORDER BY id DESC LIMIT 1',
      ['nightly_reconciliation'],
    );
    const runId = rows[0] ? Number(rows[0].id) : undefined;

    const outcomes = await runReconciliation(runId);
    const failed = outcomes.filter((o) => o.status === 'fail').length;

    return {
      checks: outcomes.length,
      passed: outcomes.filter((o) => o.status === 'pass').length,
      failed,
      failures: outcomes.filter((o) => o.status === 'fail').map((o) => o.name),
    };
  },
};

/** Beta exit criterion: seven consecutive days with no failed check. */
export async function consecutiveCleanDays(): Promise<number> {
  const { rows } = await pool.query<{ run_date: string; failures: string }>(
    'SELECT run_date, count(*) FILTER (WHERE status = $1) AS failures' +
      ' FROM reconciliation_checks GROUP BY run_date ORDER BY run_date DESC LIMIT 30',
    ['fail'],
  );

  let streak = 0;
  for (const row of rows) {
    if (Number(row.failures) > 0) break;
    streak += 1;
  }
  return streak;
}
