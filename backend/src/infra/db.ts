// Postgres access. The ledger needs real transactions, so every wallet-mutating
// operation MUST go through withTransaction.
import { Pool, PoolClient } from 'pg';
import { config } from '../config/index.js';
import { logger } from './logger.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Caps a runaway query at the SERVER, not just the client, so a bad plan
  // cannot pin a connection open and starve the pool.
  statement_timeout: config.dbStatementTimeoutMs,
  // A transaction left open by a crashed handler would otherwise hold its row
  // locks forever, and on the ledger those locks are what serialise spending.
  idle_in_transaction_session_timeout: 30_000,
});

// An idle client can fail long after its query returned — a network blip, or the
// server restarting. Unhandled, that becomes an uncaught exception and takes the
// process down.
pool.on('error', (err) => logger.error('idle postgres client error', err));

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // Rollback can itself fail if the connection died mid-transaction. Swallow
    // that so the ORIGINAL error is what propagates — it is the useful one.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('rollback failed', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}
