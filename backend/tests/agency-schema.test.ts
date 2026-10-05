// Migration 019: the rules the agency schema enforces on its own, before any
// service exists. Each of these is a guarantee a later bug in application code
// must not be able to break, so each is tested against the database directly.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../src/infra/db.js';
import { closePool, createUser, resetLedger } from './helpers.js';

async function createAgency(): Promise<{
  agencyId: string;
  ownerId: string;
  agentId: string;
  adminId: string;
}> {
  const adminId = await createUser('active');
  const ownerId = await createUser('active');
  const agencyId = uuidv7();
  const agentId = uuidv7();
  await withTransaction(async (c) => {
    // Agency first, owner seat second: the deferred FK is what allows it.
    await c.query(
      'INSERT INTO agencies (id, name, owner_user_id, owner_agent_id, created_by) VALUES ($1, $2, $3, $4, $5)',
      [agencyId, 'Sur Talent', ownerId, agentId, adminId],
    );
    await c.query(
      'INSERT INTO agents (id, user_id, can_manage_agents, created_by) VALUES ($1, $2, true, $3)',
      [agentId, ownerId, adminId],
    );
    await c.query(
      'INSERT INTO agent_agency_assignments (id, agent_id, agency_id, created_by) VALUES ($1, $2, $3, $4)',
      [uuidv7(), agentId, agencyId, adminId],
    );
  });
  return { agencyId, ownerId, agentId, adminId };
}

async function recordPrepay(
  agencyId: string,
  makerId: string,
  reference = 'UTR' + uuidv7().slice(0, 12),
) {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO agency_prepays
       (id, agency_id, amount_paise, coins_per_rupee, coins, method, payment_reference, recorded_by)
     VALUES ($1, $2, 1000000, 124, 1240000, 'bank_transfer', $3, $4)`,
    [id, agencyId, reference, makerId],
  );
  return id;
}

beforeEach(resetLedger);
afterAll(closePool);

describe('agency tree', () => {
  it('lets an agency and its owner seat be created together', async () => {
    const { agencyId, agentId } = await createAgency();
    const { rows } = await pool.query(
      'SELECT owner_agent_id, public_id FROM agencies WHERE id = $1',
      [agencyId],
    );
    expect(rows[0].owner_agent_id).toBe(agentId);
    expect(Number(rows[0].public_id)).toBeGreaterThan(700000);
  });

  it('refuses an agency whose owner seat never appears', async () => {
    const adminId = await createUser('active');
    const ownerId = await createUser('active');
    await expect(
      withTransaction((c) =>
        c.query(
          'INSERT INTO agencies (id, name, owner_user_id, owner_agent_id, created_by) VALUES ($1, $2, $3, $4, $5)',
          [uuidv7(), 'Ghost', ownerId, uuidv7(), adminId],
        ),
      ),
    ).rejects.toThrow(/fk_agency_owner_agent/);
  });

  it('never lets a host sit with two agents at once', async () => {
    const { agentId } = await createAgency();
    const host = await createUser('active');
    await pool.query(
      "INSERT INTO host_agent_assignments (id, host_user_id, agent_id, effective_from, effective_to) VALUES ($1, $2, $3, '2026-09-01', '2026-09-15')",
      [uuidv7(), host, agentId],
    );
    // Touching at the boundary is a move, not an overlap.
    await pool.query(
      "INSERT INTO host_agent_assignments (id, host_user_id, agent_id, effective_from) VALUES ($1, $2, $3, '2026-09-15')",
      [uuidv7(), host, agentId],
    );
    await expect(
      pool.query(
        "INSERT INTO host_agent_assignments (id, host_user_id, agent_id, effective_from) VALUES ($1, $2, $3, '2026-09-20')",
        [uuidv7(), host, agentId],
      ),
    ).rejects.toThrow(/host_assignment_no_overlap/);
  });

  it('never lets an agent sit in two agencies at once', async () => {
    const a = await createAgency();
    const b = await createAgency();
    await expect(
      pool.query(
        'INSERT INTO agent_agency_assignments (id, agent_id, agency_id, created_by) VALUES ($1, $2, $3, $4)',
        [uuidv7(), a.agentId, b.agencyId, a.adminId],
      ),
    ).rejects.toThrow(/agent_assignment_no_overlap/);
  });

  it('allows one pending join request per host and agent', async () => {
    const { agentId } = await createAgency();
    const host = await createUser('active');
    const insert = () =>
      pool.query(
        "INSERT INTO agency_join_requests (id, host_user_id, agent_id, direction, expires_at) VALUES ($1, $2, $3, 'host_applied', now() + interval '7 days')",
        [uuidv7(), host, agentId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/uq_join_request_pending/);
  });
});

describe('agency prepay — maker-checker', () => {
  it('refuses a prepay confirmed by the admin who recorded it', async () => {
    const { agencyId, adminId } = await createAgency();
    const id = await recordPrepay(agencyId, adminId);
    await expect(
      pool.query(
        "UPDATE agency_prepays SET status = 'rejected', decided_by = $2, decided_at = now(), reject_reason = 'x' WHERE id = $1",
        [id, adminId],
      ),
    ).rejects.toThrow(/prepay_maker_is_not_checker/);
  });

  it('refuses a confirmation with no ledger transaction behind it', async () => {
    const { agencyId, adminId } = await createAgency();
    const checker = await createUser('active');
    const id = await recordPrepay(agencyId, adminId);
    await expect(
      pool.query(
        "UPDATE agency_prepays SET status = 'confirmed', decided_by = $2, decided_at = now() WHERE id = $1",
        [id, checker],
      ),
    ).rejects.toThrow(/prepay_state_consistent/);
  });

  it('keeps a decided prepay final', async () => {
    const { agencyId, adminId } = await createAgency();
    const checker = await createUser('active');
    const id = await recordPrepay(agencyId, adminId);
    await pool.query(
      "UPDATE agency_prepays SET status = 'rejected', decided_by = $2, decided_at = now(), reject_reason = 'No credit found' WHERE id = $1",
      [id, checker],
    );
    await expect(
      pool.query("UPDATE agency_prepays SET reject_reason = 'changed' WHERE id = $1", [id]),
    ).rejects.toThrow(/already rejected/);
    await expect(pool.query('DELETE FROM agency_prepays WHERE id = $1', [id])).rejects.toThrow(
      /never deleted/,
    );
  });

  it('never records one bank credit twice', async () => {
    const { agencyId, adminId } = await createAgency();
    await recordPrepay(agencyId, adminId, 'UTR000111222');
    await expect(recordPrepay(agencyId, adminId, 'UTR000111222')).rejects.toThrow(/duplicate key/);
  });

  it('refuses coins that do not match the frozen rate', async () => {
    const { agencyId, adminId } = await createAgency();
    await expect(
      pool.query(
        `INSERT INTO agency_prepays (id, agency_id, amount_paise, coins_per_rupee, coins, method, payment_reference, recorded_by)
         VALUES ($1, $2, 1000000, 124, 1760000, 'upi', 'UPI123456', $3)`,
        [uuidv7(), agencyId, adminId],
      ),
    ).rejects.toThrow(/prepay_coins_match_rate/);
  });
});

describe('agency ledger wiring', () => {
  it('accepts agency-scoped ledger accounts', async () => {
    const { agencyId } = await createAgency();
    await pool.query(
      "INSERT INTO ledger_accounts (code, account_type, scope_type, scope_id, unit) VALUES ('agency_inventory', 'liability', 'agency', $1, 'coin')",
      [agencyId],
    );
  });

  it('books an agency transfer in coins only, and has both live now the service ships', async () => {
    const { rows } = await pool.query(
      "SELECT code, units_touched, is_active FROM ledger_txn_types WHERE code IN ('purchase_reseller', 'reseller_prepay') ORDER BY code",
    );
    // Switched on by migration 021. is_active stays the money-layer kill
    // switch: either one set false stops that flow platform-wide, no deploy.
    expect(rows).toEqual([
      { code: 'purchase_reseller', units_touched: ['coin'], is_active: true },
      {
        code: 'reseller_prepay',
        units_touched: ['coin', 'paise'],
        is_active: true,
      },
    ]);
  });

  it('keeps the transfer log append-only and one-directional', async () => {
    const { agencyId, ownerId } = await createAgency();
    const user = await createUser('active');
    const insertTransfer = async (recipient: string) => {
      const txnId = uuidv7();
      await pool.query(
        "INSERT INTO ledger_txns (id, txn_type, idempotency_key, identity, rates) VALUES ($1, 'purchase_reseller', $2, '{}', '{}')",
        [txnId, 'test:' + txnId],
      );
      await pool.query(
        'INSERT INTO agency_transfers (id, agency_id, recipient_user_id, coins, sent_by_user_id, request_id, ledger_txn_id) VALUES ($1, $2, $3, 1000, $4, $5, $1)',
        [txnId, agencyId, recipient, ownerId, uuidv7()],
      );
      return txnId;
    };
    const id = await insertTransfer(user);
    await expect(
      pool.query('UPDATE agency_transfers SET coins = 1 WHERE id = $1', [id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM agency_transfers WHERE id = $1', [id])).rejects.toThrow(
      /append-only/,
    );
    await expect(insertTransfer(ownerId)).rejects.toThrow(/transfer_not_to_sender/);
  });

  it('seeds D/C/B/A/S commission levels and the withdrawal ladder', async () => {
    const { rows } = await pool.query(
      "SELECT key, value FROM app_config WHERE key IN ('commission_levels', 'withdrawals') ORDER BY key",
    );
    const levels = rows[0].value as Array<{ level: string; rateBp: number }>;
    expect(levels.map((l) => `${l.level}:${l.rateBp}`)).toEqual([
      'D:400',
      'C:800',
      'B:1200',
      'A:1600',
      'S:2000',
    ]);
    expect(rows[1].value.host).toEqual({
      minPaise: 100_000,
      stepPaise: 100_000,
    });
    expect(rows[1].value.agent.minPaise).toBe(200_000);
    expect(rows[1].value.agency.minPaise).toBe(200_000);
  });

  it('gives a sub-agent a point account of their own', async () => {
    const { agentId } = await createAgency();
    await pool.query(
      "INSERT INTO ledger_accounts (code, account_type, scope_type, scope_id, unit) VALUES ('agent_points_withdrawable', 'liability', 'agent', $1, 'point')",
      [agentId],
    );
  });

  it('seeds the agency dials', async () => {
    const { rows } = await pool.query("SELECT value FROM app_config WHERE key = 'agency'");
    expect(rows[0].value.minPrepayPaise).toBe(1_000_000);
    expect(
      rows[0].value.wholesaleTiers.map((t: { coinsPerRupee: number }) => t.coinsPerRupee),
    ).toEqual([124, 132, 140]);
  });
});
