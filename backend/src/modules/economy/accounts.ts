// Account templates and resolution.
//
// System accounts are seeded by migration 002 and only ever looked up. Scoped
// accounts (per user, per host) are auto-provisioned on first use, so signup
// does not fan out into a pile of empty rows.

import { PoolClient } from 'pg';
import { UnknownAccountError } from '../../infra/errors.js';
import { Unit } from '../../shared/types.js';

export type AccountType =
  | 'asset'
  | 'liability'
  | 'revenue'
  | 'expense'
  | 'contra_revenue'
  | 'contra_liability';

interface AccountTemplate {
  accountType: AccountType;
  scopeType: 'user' | 'host';
  unit: Unit;
}

/**
 * Scoped accounts. `allowNegative` is always false here — a user cannot spend
 * what they do not have, and a host cannot owe us points. Their counterparties
 * are the system float accounts, which run negative by design.
 */
export const SCOPED_ACCOUNTS = {
  user_coins: { accountType: 'liability', scopeType: 'user', unit: 'coin' },
  user_gems: { accountType: 'liability', scopeType: 'user', unit: 'coin' },
  host_points_held: { accountType: 'liability', scopeType: 'host', unit: 'point' },
  host_points_withdrawable: { accountType: 'liability', scopeType: 'host', unit: 'point' },
  host_points_pending_payout: { accountType: 'liability', scopeType: 'host', unit: 'point' },
} as const satisfies Record<string, AccountTemplate>;

export type ScopedAccountCode = keyof typeof SCOPED_ACCOUNTS;

export interface ResolvedAccount {
  /**
   * Always a JS number. node-pg hands back int8/bigserial columns as STRINGS,
   * and a string id silently breaks every Map lookup keyed on it — which is
   * exactly how a balance check can end up reading zero for every account.
   * Convert at this boundary so nothing downstream has to remember.
   */
  id: number;
  code: string;
  /** True for user/host accounts: they carry a cached balance and can be locked. */
  tracked: boolean;
}

function isScoped(code: string): code is ScopedAccountCode {
  return code in SCOPED_ACCOUNTS;
}

/**
 * Resolve an account to its id, creating it if this is its first use.
 *
 * Tracked accounts get their `account_balances` row created at the same time, so
 * every later `SELECT … FOR UPDATE` finds a row to lock. Without that, two
 * concurrent first-spends could race past the lock entirely.
 */
export async function resolveAccount(
  client: PoolClient,
  code: string,
  scopeId?: string,
): Promise<ResolvedAccount> {
  if (!isScoped(code)) {
    // System account — seeded by migration, never created on the fly.
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM ledger_accounts WHERE code = $1 AND scope_id IS NULL',
      [code],
    );
    if (!rows[0]) throw new UnknownAccountError(code);
    return { id: Number(rows[0].id), code, tracked: false };
  }

  if (!scopeId) throw new UnknownAccountError(`${code} (missing scope_id)`);
  const tpl = SCOPED_ACCOUNTS[code];

  // DO UPDATE rather than DO NOTHING so RETURNING yields a row either way.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ledger_accounts (code, account_type, scope_type, scope_id, unit, allow_negative)
          VALUES ($1, $2, $3, $4, $5, false)
     ON CONFLICT (code, scope_id) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`,
    [code, tpl.accountType, tpl.scopeType, scopeId, tpl.unit],
  );
  const id = Number(rows[0].id);

  await client.query(
    'INSERT INTO account_balances (account_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING',
    [id],
  );

  return { id, code, tracked: true };
}
