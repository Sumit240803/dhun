// Sub-agents: inviting one, listing the roster, and removing one.
//
// An agent seat is an org-chart position AND a payee — a sub-agent earns
// commission points on their own hosts and withdraws them directly. Two things
// follow, and they are the whole of this file's difficulty:
//
//   · Joining needs consent. Nobody is enrolled into an earning relationship by
//     somebody else filling in a form, so an invite is offered and accepted.
//   · Leaving must not strand anyone. A removed agent's hosts joined an AGENCY,
//     not a person; they move to the owner's seat rather than losing theirs.
//
// Money never moves here. The dated links this file writes are what the
// commission engine will read, by gift timestamp.

import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { agentSeat, membershipConfig, type AgencyRef } from './agency.service.js';

export interface AgentInvite {
  id: string;
  status: string;
  canManageAgents: boolean;
  message: string | null;
  createdAt: string;
  expiresAt: string;
  agency: AgencyRef;
  invited: { userId: string; publicId: number; displayName: string | null };
}

export interface RosterAgent {
  id: string;
  publicId: number;
  userId: string;
  displayName: string | null;
  canManageAgents: boolean;
  isOwner: boolean;
  joinedAt: string;
  /** Hosts currently assigned to this agent. */
  hostCount: number;
}

type Queryable = Pick<PoolClient, 'query'>;

/** The caller's seat, if they may manage agents at all. */
async function managerSeat(userId: string) {
  const seat = await agentSeat(userId);
  if (!seat || !seat.canManageAgents) {
    throw new AppError('CANNOT_MANAGE_AGENTS', 'You cannot add or remove agents', 403);
  }
  return seat;
}

// ── The roster ──────────────────────────────────────────────────────────────

export async function listAgents(userId: string): Promise<RosterAgent[]> {
  const seat = await managerSeat(userId);
  const { rows } = await pool.query(
    `SELECT a.id, a.public_id, a.user_id, p.display_name, a.can_manage_agents,
            aa.effective_from, g.owner_agent_id,
            (SELECT count(*) FROM host_agent_assignments h
              WHERE h.agent_id = a.id AND h.effective_to IS NULL) AS host_count
       FROM agent_agency_assignments aa
       JOIN agents a ON a.id = aa.agent_id
       JOIN agencies g ON g.id = aa.agency_id
       LEFT JOIN user_profiles p ON p.user_id = a.user_id
      WHERE aa.agency_id = $1 AND aa.effective_to IS NULL AND a.status = 'active'
      ORDER BY (a.id = g.owner_agent_id) DESC, aa.effective_from`,
    [seat.agency.id],
  );
  return rows.map((r) => ({
    id: r.id,
    publicId: Number(r.public_id),
    userId: r.user_id,
    displayName: r.display_name,
    canManageAgents: r.can_manage_agents,
    isOwner: r.id === r.owner_agent_id,
    joinedAt: r.effective_from.toISOString(),
    hostCount: Number(r.host_count),
  }));
}

// ── Inviting ────────────────────────────────────────────────────────────────

const INVITE_SELECT = `
  SELECT i.id, i.status, i.can_manage_agents, i.message, i.created_at, i.expires_at,
         i.invited_user_id, u.public_id AS invited_public_id, p.display_name,
         g.id AS agency_id, g.public_id AS agency_public_id, g.name AS agency_name, g.is_house
    FROM agent_invites i
    JOIN users u ON u.id = i.invited_user_id
    LEFT JOIN user_profiles p ON p.user_id = i.invited_user_id
    JOIN agencies g ON g.id = i.agency_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toInvite(r: any): AgentInvite {
  return {
    id: r.id,
    status: r.status === 'pending' && r.expires_at <= new Date() ? 'expired' : r.status,
    canManageAgents: r.can_manage_agents,
    message: r.message,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    agency: {
      id: r.agency_id,
      publicId: Number(r.agency_public_id),
      name: r.agency_name,
      isHouse: r.is_house,
    },
    invited: {
      userId: r.invited_user_id,
      publicId: Number(r.invited_public_id),
      displayName: r.display_name,
    },
  };
}

async function getInvite(id: string): Promise<AgentInvite> {
  const { rows } = await pool.query(`${INVITE_SELECT} WHERE i.id = $1`, [id]);
  if (!rows[0]) throw new AppError('INVITE_NOT_FOUND', 'That invitation does not exist', 404);
  return toInvite(rows[0]);
}

/**
 * Invite someone to hold an agent seat.
 *
 * By User ID alone, with no second factor — unlike inviting a HOST, which needs
 * the Host Code. The difference is what a wrong guess costs: a mistaken host
 * invite reaches a stranger who might accept and start earning under you, while
 * a mistaken agent invite reaches a stranger who sees an offer to run a team
 * for an agency they have never heard of, and declines. The protection here is
 * that an agent seat does nothing until it is accepted.
 */
export async function inviteAgent(
  userId: string,
  input: { invitedPublicId: number; canManageAgents?: boolean; message?: string },
): Promise<AgentInvite> {
  const seat = await managerSeat(userId);
  const cfg = await membershipConfig();

  const id = await withTransaction(async (c) => {
    const { rows } = await c.query(
      "SELECT id FROM users WHERE public_id = $1 AND status = 'active'",
      [input.invitedPublicId],
    );
    const invited = rows[0];
    if (!invited) throw new AppError('USER_NOT_FOUND', 'No active account has that User ID', 404);
    if (invited.id === userId) {
      throw new AppError('ALREADY_AN_AGENT', 'You already hold an agent seat', 409);
    }

    await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [invited.id]);
    const { rows: existing } = await c.query('SELECT status FROM agents WHERE user_id = $1', [
      invited.id,
    ]);
    // One seat per person. A second would make "which agency is this agent in"
    // a question with two answers, and the dated link exists so it never is.
    if (existing[0]?.status === 'active') {
      throw new AppError('ALREADY_AN_AGENT', 'That person already holds an agent seat', 409);
    }
    const { rows: hosting } = await c.query(
      'SELECT 1 FROM host_agent_assignments WHERE host_user_id = $1 AND effective_to IS NULL',
      [invited.id],
    );
    // Being a host under one agent while being an agent in the same tree makes
    // the commission walk ambiguous, and in the worst case self-referential.
    if (hosting[0]) {
      throw new AppError(
        'USER_IS_HOST',
        'That person is a host and must leave their agency first',
        409,
      );
    }

    const inviteId = uuidv7();
    const { rowCount } = await c.query(
      `INSERT INTO agent_invites
         (id, agency_id, invited_user_id, can_manage_agents, message, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))
       ON CONFLICT (agency_id, invited_user_id) WHERE status = 'pending' DO NOTHING`,
      [
        inviteId,
        seat.agency.id,
        invited.id,
        input.canManageAgents ?? false,
        input.message ?? null,
        userId,
        cfg.joinRequestExpiryDays,
      ],
    );
    if (!rowCount) {
      throw new AppError('INVITE_ALREADY_PENDING', 'They already have an invitation waiting', 409);
    }
    return inviteId;
  });

  return getInvite(id);
}

/** Invitations waiting for the caller to answer. */
export async function myAgentInvites(userId: string): Promise<AgentInvite[]> {
  const { rows } = await pool.query(
    `${INVITE_SELECT}
      WHERE i.invited_user_id = $1 AND i.status = 'pending' AND i.expires_at > now()
      ORDER BY i.created_at DESC
      LIMIT 20`,
    [userId],
  );
  return rows.map(toInvite);
}

export async function answerAgentInvite(
  userId: string,
  inviteId: string,
  accept: boolean,
): Promise<AgentInvite> {
  await withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT invited_user_id, agency_id, can_manage_agents, status, expires_at <= now() AS expired
         FROM agent_invites WHERE id = $1 FOR UPDATE`,
      [inviteId],
    );
    const invite = rows[0];
    // Not theirs to answer, and not theirs to learn about either.
    if (!invite || invite.invited_user_id !== userId) {
      throw new AppError('INVITE_NOT_FOUND', 'That invitation does not exist', 404);
    }
    if (invite.status !== 'pending') {
      throw new AppError('INVITE_CLOSED', 'That invitation is no longer open', 409);
    }
    if (invite.expired) {
      await c.query(
        "UPDATE agent_invites SET status = 'expired', decided_at = now() WHERE id = $1",
        [inviteId],
      );
      throw new AppError('INVITE_CLOSED', 'That invitation is no longer open', 409);
    }

    if (!accept) {
      await c.query(
        "UPDATE agent_invites SET status = 'declined', decided_at = now() WHERE id = $1",
        [inviteId],
      );
      return;
    }

    await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
    const { rows: agency } = await c.query(
      "SELECT status FROM agencies WHERE id = $1 AND status = 'active'",
      [invite.agency_id],
    );
    if (!agency[0]) {
      throw new AppError('AGENCY_UNAVAILABLE', 'That agency is not active', 409);
    }
    const { rows: hosting } = await c.query(
      'SELECT 1 FROM host_agent_assignments WHERE host_user_id = $1 AND effective_to IS NULL',
      [userId],
    );
    if (hosting[0]) {
      throw new AppError('USER_IS_HOST', 'Leave your agency before becoming an agent', 409);
    }
    const { rows: seats } = await c.query(
      "SELECT id FROM agents WHERE user_id = $1 AND status = 'active'",
      [userId],
    );
    if (seats[0]) throw new AppError('ALREADY_AN_AGENT', 'You already hold an agent seat', 409);

    // A seat is per PERSON and outlives any one agency: agents.user_id is
    // unique, which is what keeps "which agency is this agent in" a question
    // with one answer. Someone removed from one agency and invited by another
    // therefore revives their row, and keeps the Agent ID hosts already have
    // written down. The dated assignment below is what records the move.
    const { rows: seat } = await c.query<{ id: string }>(
      `INSERT INTO agents (id, user_id, can_manage_agents, created_by)
            VALUES ($1, $2, $3, $2)
       ON CONFLICT (user_id) DO UPDATE
              SET status = 'active', can_manage_agents = EXCLUDED.can_manage_agents
        RETURNING id`,
      [uuidv7(), userId, invite.can_manage_agents],
    );
    const agentId = seat[0].id;
    await c.query(
      'INSERT INTO agent_agency_assignments (id, agent_id, agency_id, created_by) VALUES ($1, $2, $3, $4)',
      [uuidv7(), agentId, invite.agency_id, userId],
    );
    await c.query(
      `INSERT INTO role_assignments (id, user_id, role_code, scope_type, scope_id, granted_by, reason)
       VALUES ($1, $2, 'sub_agent', 'agency', $3, $2, 'agent invitation accepted')
       ON CONFLICT DO NOTHING`,
      [uuidv7(), userId, invite.agency_id],
    );
    await c.query(
      "UPDATE agent_invites SET status = 'accepted', decided_at = now() WHERE id = $1",
      [inviteId],
    );
    // Every other agency's offer is moot now.
    await c.query(
      `UPDATE agent_invites SET status = 'cancelled', decided_at = now()
        WHERE invited_user_id = $1 AND status = 'pending' AND id <> $2`,
      [userId, inviteId],
    );
  });

  return getInvite(inviteId);
}

/** Withdraw an invitation the agency sent. */
export async function cancelAgentInvite(userId: string, inviteId: string): Promise<AgentInvite> {
  const seat = await managerSeat(userId);
  const { rowCount } = await pool.query(
    `UPDATE agent_invites SET status = 'cancelled', decided_at = now()
      WHERE id = $1 AND agency_id = $2 AND status = 'pending'`,
    [inviteId, seat.agency.id],
  );
  if (!rowCount) {
    await getInvite(inviteId);
    throw new AppError('INVITE_CLOSED', 'That invitation is no longer open', 409);
  }
  return getInvite(inviteId);
}

/** Invitations this agency has outstanding. */
export async function agencyAgentInvites(userId: string): Promise<AgentInvite[]> {
  const seat = await managerSeat(userId);
  const { rows } = await pool.query(
    `${INVITE_SELECT}
      WHERE i.agency_id = $1 AND i.status = 'pending' AND i.expires_at > now()
      ORDER BY i.created_at DESC
      LIMIT 100`,
    [seat.agency.id],
  );
  return rows.map(toInvite);
}

// ── Removing ────────────────────────────────────────────────────────────────

/**
 * Remove an agent, and move their hosts to the owner.
 *
 * The hosts joined an AGENCY, not a person. Dropping them when their agent
 * leaves would stop their earnings through no act of their own, so each dated
 * link is closed and reopened against the owner's seat at the same instant —
 * which the no-overlap constraint permits precisely because the ranges touch
 * rather than overlap, and which leaves every past gift attributed to the agent
 * who actually held them at the time.
 */
export async function removeAgent(
  userId: string,
  agentId: string,
): Promise<{ removed: string; hostsMoved: number }> {
  const seat = await managerSeat(userId);

  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT a.id, a.user_id, g.owner_agent_id
         FROM agent_agency_assignments aa
         JOIN agents a ON a.id = aa.agent_id
         JOIN agencies g ON g.id = aa.agency_id
        WHERE aa.agent_id = $1 AND aa.agency_id = $2 AND aa.effective_to IS NULL
          AND a.status = 'active'
        FOR UPDATE OF a, aa`,
      [agentId, seat.agency.id],
    );
    const agent = rows[0];
    if (!agent) throw new AppError('AGENT_NOT_IN_AGENCY', 'That agent is not in your agency', 404);
    // The owner's seat is the agency. Removing it would leave the tree with no
    // root and the hosts with nowhere to go.
    if (agent.id === agent.owner_agent_id) {
      throw new AppError('CANNOT_REMOVE_OWNER', 'The agency owner cannot be removed', 409);
    }

    const { rows: hosts } = await c.query(
      `UPDATE host_agent_assignments SET effective_to = now(), ended_by = $2,
              end_reason = 'agent_removed'
        WHERE agent_id = $1 AND effective_to IS NULL
        RETURNING host_user_id`,
      [agentId, userId],
    );
    for (const host of hosts) {
      await c.query(
        `INSERT INTO host_agent_assignments (id, host_user_id, agent_id, effective_from)
         VALUES ($1, $2, $3, now())`,
        [uuidv7(), host.host_user_id, agent.owner_agent_id],
      );
    }

    await c.query(
      `UPDATE agent_agency_assignments SET effective_to = now(), ended_by = $2,
              end_reason = 'removed'
        WHERE agent_id = $1 AND effective_to IS NULL`,
      [agentId, userId],
    );
    await c.query("UPDATE agents SET status = 'removed' WHERE id = $1", [agentId]);
    await c.query(
      `UPDATE role_assignments SET revoked_at = now(), revoked_by = $3
        WHERE user_id = $1 AND role_code = 'sub_agent' AND scope_id = $2 AND revoked_at IS NULL`,
      [agent.user_id, seat.agency.id, userId],
    );

    return { removed: agentId, hostsMoved: hosts.length };
  });
}

/** Grant or withdraw the ability to recruit other agents. */
export async function setAgentManagement(
  userId: string,
  agentId: string,
  canManage: boolean,
): Promise<RosterAgent> {
  const seat = await managerSeat(userId);
  if (!seat.isOwner) {
    throw new AppError('NOT_AGENCY_OWNER', 'Only the agency owner can change this', 403);
  }
  const { rowCount } = await pool.query(
    `UPDATE agents SET can_manage_agents = $3
      WHERE id = $1 AND status = 'active'
        AND id <> (SELECT owner_agent_id FROM agencies WHERE id = $2)
        AND EXISTS (SELECT 1 FROM agent_agency_assignments
                     WHERE agent_id = $1 AND agency_id = $2 AND effective_to IS NULL)`,
    [agentId, seat.agency.id, canManage],
  );
  if (!rowCount) {
    throw new AppError('AGENT_NOT_IN_AGENCY', 'That agent is not in your agency', 404);
  }
  const roster = await listAgents(userId);
  return roster.find((a) => a.id === agentId)!;
}

/** The hosts an agent currently holds — the answer needed before removing them. */
export async function agentHosts(
  userId: string,
  agentId: string,
  db: Queryable = pool,
): Promise<Array<{ userId: string; publicId: number; displayName: string | null }>> {
  const seat = await managerSeat(userId);
  const { rows } = await db.query(
    `SELECT h.host_user_id, u.public_id, p.display_name
       FROM host_agent_assignments h
       JOIN agent_agency_assignments aa
         ON aa.agent_id = h.agent_id AND aa.agency_id = $2 AND aa.effective_to IS NULL
       JOIN users u ON u.id = h.host_user_id
       LEFT JOIN user_profiles p ON p.user_id = h.host_user_id
      WHERE h.agent_id = $1 AND h.effective_to IS NULL
      ORDER BY h.effective_from DESC
      LIMIT 200`,
    [agentId, seat.agency.id],
  );
  return rows.map((r) => ({
    userId: r.host_user_id,
    publicId: Number(r.public_id),
    displayName: r.display_name,
  }));
}
