// The double-entry ledger. This is the financial source of truth.
//
// Every money movement in the system goes through postTransaction(). Nothing
// else may write to ledger_* or account_balances.
//
// Guarantees, and who enforces them:
//   · legs sum to zero per unit   — checked here, enforced again by a deferred
//                                   constraint trigger at COMMIT
//   · entries are append-only     — enforced by a database trigger
//   · balances never go negative  — checked here under a row lock, and by a
//                                   CHECK constraint on account_balances
//   · one effect per key          — enforced by a UNIQUE index
//
// See backend/docs/ledger-decisions.md, Sections A and B.

import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTransaction } from '../../infra/db.js';
import {
  IdempotencyKeyReusedError,
  InsufficientBalanceError,
  RequestInProgressError,
  TxnTypeInactiveError,
  UnbalancedTransactionError,
} from '../../infra/errors.js';
import { resolveAccount, ResolvedAccount } from './accounts.js';
import { Leg, PostTxnInput, PostTxnResult } from './ledger.types.js';

const IDEMPOTENCY_CONSTRAINT = 'ledger_txns_idempotency_key_key';

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}

/**
 * Fail fast, in application code, before touching the database. The deferred
 * constraint trigger catches this too, but its error arrives at COMMIT with no
 * context about which caller built the bad legs.
 */
function assertBalanced(legs: Leg[]): void {
  const perUnit = new Map<string, number>();
  for (const leg of legs) {
    if (leg.amount === 0) throw new UnbalancedTransactionError(leg.unit, 0);
    perUnit.set(leg.unit, (perUnit.get(leg.unit) ?? 0) + leg.amount);
  }
  for (const [unit, total] of perUnit) {
    if (total !== 0) throw new UnbalancedTransactionError(unit, total);
  }
}

interface ExistingTxn {
  id: string;
  status: string;
  response_body: Record<string, unknown> | null;
  identity_matches: boolean;
}

async function findByKey(
  client: PoolClient,
  key: string,
  identity: Record<string, unknown>,
): Promise<ExistingTxn | undefined> {
  const { rows } = await client.query<ExistingTxn>(
    'SELECT id, status, response_body, (identity = $2::jsonb) AS identity_matches' +
      ' FROM ledger_txns WHERE idempotency_key = $1',
    [key, JSON.stringify(identity)],
  );
  return rows[0];
}

/**
 * What a repeat of this idempotency key gets back (§ B2):
 *   different identity → 422, a client bug made loud
 *   still pending      → 409, retry shortly
 *   completed          → the original response, unchanged
 */
function replayOrThrow(existing: ExistingTxn, key: string): PostTxnResult {
  if (!existing.identity_matches) throw new IdempotencyKeyReusedError(key);
  if (existing.status === 'pending') throw new RequestInProgressError(key);
  return {
    txnId: existing.id,
    replayed: true,
    // response_body is purged after 7 days; a late replay still gets a truthful
    // answer, just without the original payload.
    response: existing.response_body ?? { already_applied: true, txn_id: existing.id },
  };
}

export async function postTransaction(input: PostTxnInput): Promise<PostTxnResult> {
  assertBalanced(input.legs);

  const seen = await withTransaction((c) => findByKey(c, input.idempotencyKey, input.identity));
  if (seen) return replayOrThrow(seen, input.idempotencyKey);

  try {
    return await withTransaction((client) => post(client, input));
  } catch (err) {
    // Someone raced us. Their INSERT took the unique index; ours waited on it and
    // then failed. Their transaction has committed by now, so re-read and replay.
    if (isUniqueViolation(err, IDEMPOTENCY_CONSTRAINT)) {
      const raced = await withTransaction((c) =>
        findByKey(c, input.idempotencyKey, input.identity),
      );
      if (raced) return replayOrThrow(raced, input.idempotencyKey);
    }
    throw err;
  }
}

async function post(client: PoolClient, input: PostTxnInput): Promise<PostTxnResult> {
  const { rows: typeRows } = await client.query<{ is_active: boolean }>(
    'SELECT is_active FROM ledger_txn_types WHERE code = $1',
    [input.txnType],
  );
  // The money-layer kill switch: flipping is_active stops a feature
  // platform-wide, with no deploy.
  if (!typeRows[0]?.is_active) throw new TxnTypeInactiveError(input.txnType);

  const txnId = uuidv7();
  await client.query(
    'INSERT INTO ledger_txns' +
      ' (id, txn_type, idempotency_key, identity, rates, actor_user_id, reverses_txn_id, memo, status)' +
      " VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,'pending')",
    [
      txnId,
      input.txnType,
      input.idempotencyKey,
      JSON.stringify(input.identity),
      JSON.stringify(input.rates),
      input.actorUserId ?? null,
      input.reversesTxnId ?? null,
      input.memo ?? null,
    ],
  );

  const resolved: Array<Leg & { account: ResolvedAccount }> = [];
  for (const leg of input.legs) {
    resolved.push({ ...leg, account: await resolveAccount(client, leg.accountCode, leg.scopeId) });
  }

  // Net the legs per account — one transaction may touch the same account twice.
  const deltas = new Map<number, { account: ResolvedAccount; delta: number }>();
  for (const leg of resolved) {
    const cur = deltas.get(leg.account.id) ?? { account: leg.account, delta: 0 };
    cur.delta += leg.amount;
    deltas.set(leg.account.id, cur);
  }

  // Lock every TRACKED account this transaction touches, ascending by id.
  //
  // The ordering is what prevents deadlock. Credits are locked as well as
  // debits: locking debits alone would still let two transactions take an
  // explicit lock and an implicit UPDATE lock in opposite orders. Tracked
  // accounts are only user/host rows — a gift locks two — so this stays cheap.
  // System accounts carry no cached balance at all, precisely so that
  // system_coin_float cannot serialise the whole platform (§ B4).
  const tracked = [...deltas.values()]
    .filter((d) => d.account.tracked)
    .sort((a, b) => a.account.id - b.account.id);

  if (tracked.length) {
    const { rows: locked } = await client.query<{ account_id: string; balance: string }>(
      'SELECT account_id, balance FROM account_balances' +
        ' WHERE account_id = ANY($1::bigint[]) ORDER BY account_id FOR UPDATE',
      [tracked.map((t) => t.account.id)],
    );

    const balances = new Map(locked.map((r) => [Number(r.account_id), Number(r.balance)]));
    for (const { account, delta } of tracked) {
      const current = balances.get(account.id) ?? 0;
      if (current + delta < 0) {
        throw new InsufficientBalanceError(account.code, current, -delta);
      }
    }
  }

  const values: string[] = [];
  const params: unknown[] = [];
  for (const leg of resolved) {
    const i = params.length;
    values.push('($' + (i + 1) + ', $' + (i + 2) + ', $' + (i + 3) + ', $' + (i + 4) + ')');
    params.push(txnId, leg.account.id, leg.unit, leg.amount);
  }
  await client.query(
    'INSERT INTO ledger_entries (txn_id, account_id, unit, amount) VALUES ' + values.join(', '),
    params,
  );

  for (const { account, delta } of tracked) {
    await client.query(
      'UPDATE account_balances SET balance = balance + $2, updated_at = now() WHERE account_id = $1',
      [account.id, delta],
    );
  }

  // Same transaction as the entries. A crash between COMMIT and publish would
  // otherwise lose the event permanently and drift analytics forever.
  for (const evt of input.events ?? []) {
    await client.query(
      'INSERT INTO outbox (event_id, event_type, partition_key, payload, txn_id)' +
        ' VALUES ($1, $2, $3, $4::jsonb, $5)',
      [uuidv7(), evt.eventType, evt.partitionKey, JSON.stringify(evt.payload), txnId],
    );
  }

  const response = input.response ?? { txn_id: txnId };
  await client.query(
    "UPDATE ledger_txns SET status = 'completed', completed_at = now(), response_body = $2::jsonb" +
      ' WHERE id = $1',
    [txnId, JSON.stringify(response)],
  );

  return { txnId, replayed: false, response };
}

/**
 * Cached balance for a scoped account. The authoritative figure is
 * SUM(ledger_entries); the nightly reconciliation job proves the two agree.
 */
export async function getBalance(accountCode: string, scopeId: string): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ balance: string }>(
      'SELECT b.balance FROM account_balances b' +
        ' JOIN ledger_accounts a ON a.id = b.account_id' +
        ' WHERE a.code = $1 AND a.scope_id = $2',
      [accountCode, scopeId],
    );
    return rows[0] ? Number(rows[0].balance) : 0;
  });
}
