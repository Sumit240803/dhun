// The back-office view of the agency network.
//
// Everything an ops person needs that is not an app feature: what agencies
// exist, what one of them actually looks like, suspending one, and the transfer
// audit — which is the only way to answer "this user says they paid and got
// nothing" from our side of a payment we never saw.
//
// Read-mostly. The one write, suspension, is recorded rather than overwritten.

import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';

export interface AgencySummary {
  id: string;
  publicId: number;
  name: string;
  status: 'active' | 'suspended' | 'closed';
  isHouse: boolean;
  coinTradingEnabled: boolean;
  createdAt: string;
  owner: { userId: string; publicId: number; displayName: string | null };
  agentCount: number;
  hostCount: number;
  inventoryCoins: number;
}

export interface AgencyDetail extends AgencySummary {
  contactEmail: string | null;
  suspendedReason: string | null;
  prepaid: { confirmedPaise: number; confirmedCoins: number; pendingCount: number };
  transferred: { coins: number; count: number };
  statusHistory: Array<{
    fromStatus: string;
    toStatus: string;
    reason: string;
    createdAt: string;
  }>;
}

const SUMMARY_SELECT = `
  SELECT g.id, g.public_id, g.name, g.status, g.is_house, g.contact_email,
         g.coin_trading_enabled_at, g.created_at, g.suspended_reason,
         g.owner_user_id, u.public_id AS owner_public_id, p.display_name AS owner_name,
         (SELECT count(*) FROM agent_agency_assignments aa
            JOIN agents a ON a.id = aa.agent_id
           WHERE aa.agency_id = g.id AND aa.effective_to IS NULL AND a.status = 'active')
           AS agent_count,
         (SELECT count(*) FROM host_agent_assignments h
            JOIN agent_agency_assignments aa
              ON aa.agent_id = h.agent_id AND aa.effective_to IS NULL
           WHERE aa.agency_id = g.id AND h.effective_to IS NULL) AS host_count,
         COALESCE((SELECT b.balance FROM account_balances b
                     JOIN ledger_accounts la ON la.id = b.account_id
                    WHERE la.code = 'agency_inventory' AND la.scope_id = g.id), 0)
           AS inventory_coins
    FROM agencies g
    JOIN users u ON u.id = g.owner_user_id
    LEFT JOIN user_profiles p ON p.user_id = g.owner_user_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSummary(r: any): AgencySummary {
  return {
    id: r.id,
    publicId: Number(r.public_id),
    name: r.name,
    status: r.status,
    isHouse: r.is_house,
    coinTradingEnabled: r.coin_trading_enabled_at !== null,
    createdAt: r.created_at.toISOString(),
    owner: {
      userId: r.owner_user_id,
      publicId: Number(r.owner_public_id),
      displayName: r.owner_name,
    },
    agentCount: Number(r.agent_count),
    hostCount: Number(r.host_count),
    inventoryCoins: Number(r.inventory_coins),
  };
}

export async function listAgencies(filter: {
  status?: 'active' | 'suspended' | 'closed';
  query?: string;
  limit: number;
}): Promise<AgencySummary[]> {
  const { rows } = await pool.query(
    `${SUMMARY_SELECT}
      WHERE ($1::text IS NULL OR g.status = $1)
        AND ($2::text IS NULL OR g.name ILIKE '%' || $2 || '%'
             OR g.public_id::text = $2 OR u.public_id::text = $2)
      ORDER BY g.created_at DESC
      LIMIT $3`,
    [filter.status ?? null, filter.query ?? null, filter.limit],
  );
  return rows.map(toSummary);
}

export async function agencyDetail(agencyId: string): Promise<AgencyDetail> {
  const { rows } = await pool.query(`${SUMMARY_SELECT} WHERE g.id = $1`, [agencyId]);
  if (!rows[0]) throw new AppError('AGENCY_NOT_FOUND', 'That agency does not exist', 404);

  const [money, history] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(amount_paise) FILTER (WHERE status = 'confirmed'), 0) AS confirmed_paise,
         COALESCE(SUM(coins) FILTER (WHERE status = 'confirmed'), 0) AS confirmed_coins,
         count(*) FILTER (WHERE status = 'pending') AS pending_count,
         (SELECT COALESCE(SUM(coins), 0) FROM agency_transfers WHERE agency_id = $1) AS sent_coins,
         (SELECT count(*) FROM agency_transfers WHERE agency_id = $1) AS sent_count
       FROM agency_prepays WHERE agency_id = $1`,
      [agencyId],
    ),
    pool.query(
      `SELECT from_status, to_status, reason, created_at
         FROM agency_status_changes WHERE agency_id = $1
        ORDER BY created_at DESC LIMIT 20`,
      [agencyId],
    ),
  ]);

  return {
    ...toSummary(rows[0]),
    contactEmail: rows[0].contact_email,
    suspendedReason: rows[0].suspended_reason,
    prepaid: {
      confirmedPaise: Number(money.rows[0].confirmed_paise),
      confirmedCoins: Number(money.rows[0].confirmed_coins),
      pendingCount: Number(money.rows[0].pending_count),
    },
    transferred: {
      coins: Number(money.rows[0].sent_coins),
      count: Number(money.rows[0].sent_count),
    },
    statusHistory: history.rows.map((h) => ({
      fromStatus: h.from_status,
      toStatus: h.to_status,
      reason: h.reason,
      createdAt: h.created_at.toISOString(),
    })),
  };
}

/**
 * Suspend an agency, or bring it back.
 *
 * Suspension is the lever for a misbehaving agency, and it is deliberately
 * blunt: `agentSeat` requires an ACTIVE agency, so a suspended one loses coin
 * trading, host recruitment and agent management in one move, immediately.
 *
 * What it does NOT touch:
 *   · the inventory coins, which the agency paid for and which are settled
 *     off-platform if the relationship ends;
 *   · its hosts, who keep earning. They joined an agency rather than a person,
 *     and punishing them for their agency's conduct would be both unfair and
 *     the fastest way to lose the hosts along with the agency.
 *
 * Each change is recorded. An agency that was suspended, argued its case and
 * was reinstated has a history that matters to whoever decides next.
 */
export async function setAgencyStatus(
  adminUserId: string,
  agencyId: string,
  status: 'active' | 'suspended' | 'closed',
  reason: string,
): Promise<AgencyDetail> {
  await withTransaction(async (c) => {
    const { rows } = await c.query('SELECT status FROM agencies WHERE id = $1 FOR UPDATE', [
      agencyId,
    ]);
    if (!rows[0]) throw new AppError('AGENCY_NOT_FOUND', 'That agency does not exist', 404);
    const from = rows[0].status as string;
    if (from === status) {
      throw new AppError('STATUS_UNCHANGED', 'That agency is already in that state', 409);
    }
    // Closed is final: reopening would resurrect a settled relationship, and
    // the honest move is a new agency with a new row.
    if (from === 'closed') {
      throw new AppError('AGENCY_CLOSED', 'A closed agency cannot be reopened', 409);
    }

    await c.query(
      `UPDATE agencies
          SET status = $2,
              suspended_reason = CASE WHEN $2 = 'active' THEN NULL ELSE $3 END
        WHERE id = $1`,
      [agencyId, status, reason],
    );
    await c.query(
      `INSERT INTO agency_status_changes (id, agency_id, from_status, to_status, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv7(), agencyId, from, status, reason, adminUserId],
    );
  });

  return agencyDetail(agencyId);
}

export interface TransferAudit {
  id: string;
  coins: number;
  note: string | null;
  createdAt: string;
  agency: { id: string; publicId: number; name: string };
  sentBy: { userId: string; publicId: number };
  recipient: { userId: string; publicId: number; displayName: string | null };
}

/**
 * The transfer audit.
 *
 * The question this answers is always the same: somebody paid an agency
 * off-platform and says the coins never arrived. We never saw that payment, so
 * the only thing we can establish is what the agency did or did not send, and
 * when. Searchable by either side's public ID for exactly that reason.
 */
export async function auditTransfers(filter: {
  agencyPublicId?: number;
  userPublicId?: number;
  limit: number;
}): Promise<TransferAudit[]> {
  const { rows } = await pool.query(
    `SELECT t.id, t.coins, t.note, t.created_at,
            g.id AS agency_id, g.public_id AS agency_public_id, g.name AS agency_name,
            t.sent_by_user_id, su.public_id AS sender_public_id,
            t.recipient_user_id, ru.public_id AS recipient_public_id, p.display_name
       FROM agency_transfers t
       JOIN agencies g ON g.id = t.agency_id
       JOIN users su ON su.id = t.sent_by_user_id
       JOIN users ru ON ru.id = t.recipient_user_id
       LEFT JOIN user_profiles p ON p.user_id = t.recipient_user_id
      WHERE ($1::bigint IS NULL OR g.public_id = $1)
        AND ($2::bigint IS NULL OR ru.public_id = $2)
      ORDER BY t.created_at DESC
      LIMIT $3`,
    [filter.agencyPublicId ?? null, filter.userPublicId ?? null, filter.limit],
  );

  return rows.map((r) => ({
    id: r.id,
    coins: Number(r.coins),
    note: r.note,
    createdAt: r.created_at.toISOString(),
    agency: { id: r.agency_id, publicId: Number(r.agency_public_id), name: r.agency_name },
    sentBy: { userId: r.sent_by_user_id, publicId: Number(r.sender_public_id) },
    recipient: {
      userId: r.recipient_user_id,
      publicId: Number(r.recipient_public_id),
      displayName: r.display_name,
    },
  }));
}
