import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../src/infra/db.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';

/**
 * Clears everything a test wrote, while keeping the 21 seeded system accounts.
 *
 * TRUNCATE rather than DELETE for the ledger tables: row-level triggers do not
 * fire on TRUNCATE, which is the only way past the append-only guard. That the
 * guard blocks ordinary cleanup is the point of it.
 */
export async function resetLedger(): Promise<void> {
  // A suite makes hundreds of requests from one address in seconds — precisely
  // what the global limit is there to stop. Reset it rather than weaken it.
  await resetRateLimits();

  await withTransaction(async (c) => {
    await c.query('TRUNCATE ledger_entries, outbox, ledger_txns CASCADE');
    await c.query('DELETE FROM account_balances');
    await c.query('DELETE FROM ledger_accounts WHERE scope_id IS NOT NULL');
    await c.query('DELETE FROM purchases');
    await c.query('DELETE FROM user_stats');
    await c.query('DELETE FROM payment_webhooks');
    await c.query('DELETE FROM role_assignments');
    await c.query('DELETE FROM refresh_tokens');
    await c.query('DELETE FROM user_devices');
    await c.query('DELETE FROM otp_challenges');
    await c.query('DELETE FROM email_verifications');

    // Everything below references users. Kept in dependency order and in ONE
    // place: a new table with a users foreign key that is not listed here makes
    // an unrelated suite fail on a constraint violation, which is a confusing
    // way to learn about it.
    await c.query('DELETE FROM reports');
    await c.query('DELETE FROM blocks');
    await c.query('DELETE FROM profile_visits');
    await c.query('DELETE FROM follows');
    await c.query('DELETE FROM messages');
    await c.query('DELETE FROM thread_participants');
    await c.query('DELETE FROM message_threads');
    await c.query('DELETE FROM rooms');

    await c.query('DELETE FROM user_profiles');
    await c.query('DELETE FROM users');
  });
}

export async function createUser(status = 'guest'): Promise<string> {
  const id = uuidv7();
  const phone = status === 'guest' ? null : '+9199' + String(Date.now()).slice(-8);
  await withTransaction((c) =>
    c.query(
      'INSERT INTO users (id, status, phone_e164, phone_verified_at) VALUES ($1,$2,$3,$4)',
      [id, status, phone, phone ? new Date() : null],
    ),
  );
  return id;
}

/** Sum of raw entries for one scoped account — the authoritative balance. */
export async function sumEntries(accountCode: string, scopeId: string): Promise<number> {
  const { rows } = await pool.query<{ total: string | null }>(
    'SELECT SUM(e.amount) AS total FROM ledger_entries e' +
      ' JOIN ledger_accounts a ON a.id = e.account_id' +
      ' WHERE a.code = $1 AND a.scope_id = $2',
    [accountCode, scopeId],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Balance of a system account. These carry no cache, so it is always computed. */
export async function systemBalance(accountCode: string): Promise<number> {
  const { rows } = await pool.query<{ total: string | null }>(
    'SELECT SUM(e.amount) AS total FROM ledger_entries e' +
      ' JOIN ledger_accounts a ON a.id = e.account_id' +
      ' WHERE a.code = $1 AND a.scope_id IS NULL',
    [accountCode],
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Reconciliation check E2: every transaction's entries must sum to zero, per
 * unit. Returns the offenders, so an empty array is a pass.
 */
export async function unbalancedTxns(): Promise<Array<{ txn_id: string; unit: string }>> {
  const { rows } = await pool.query<{ txn_id: string; unit: string }>(
    'SELECT txn_id, unit FROM ledger_entries GROUP BY txn_id, unit HAVING SUM(amount) <> 0',
  );
  return rows;
}

/**
 * Reconciliation check E1: every cached balance must equal the sum of its
 * entries. Returns the drifted accounts.
 */
export async function balanceDrift(): Promise<
  Array<{ code: string; cached: number; actual: number }>
> {
  const { rows } = await pool.query<{ code: string; cached: string; actual: string | null }>(
    'SELECT a.code, b.balance AS cached, SUM(e.amount) AS actual' +
      ' FROM account_balances b' +
      ' JOIN ledger_accounts a ON a.id = b.account_id' +
      ' LEFT JOIN ledger_entries e ON e.account_id = b.account_id' +
      ' GROUP BY a.code, b.balance' +
      ' HAVING b.balance <> COALESCE(SUM(e.amount), 0)',
  );
  return rows.map((r) => ({ code: r.code, cached: Number(r.cached), actual: Number(r.actual ?? 0) }));
}

export async function setTxnTypeActive(code: string, active: boolean): Promise<void> {
  await pool.query('UPDATE ledger_txn_types SET is_active = $2 WHERE code = $1', [code, active]);
}

export async function closePool(): Promise<void> {
  await pool.end();
}
