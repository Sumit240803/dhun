// Agency membership: who sits where, how a host joins, how a host leaves.
//
// Decisions: CLAUDE.md "Roles — host, agent, agency"; build-plan M12
// "Membership rules"; migrations 019 and 020.
//
// Three things this file is careful about:
//
//   · Consent from both sides. A host joins only when the agent accepts their
//     application, or when the host accepts the agent's invite. An invite needs
//     the host's User ID AND Host Code, because user ids are sequential and an
//     agent could otherwise invite the whole platform by counting.
//   · One agency at a time, and no poaching. A host already in an agency cannot
//     apply elsewhere or be invited elsewhere; they quit first.
//   · Every membership change locks the host's user row first. The dated links
//     cannot overlap (EXCLUDE constraint), and the lock means two concurrent
//     accepts queue instead of one of them failing on that constraint.
//
// No money moves here. Commission attribution reads the dated links later.

import { randomInt } from 'crypto';
import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { getConfigValue } from '../economy/index.js';

// ── Config ──────────────────────────────────────────────────────────────────

const membershipSchema = z.object({
  joinRequestExpiryDays: z.number().int().min(1).max(90),
  quit: z.object({
    autoLeaveDays: z.number().int().min(1).max(60),
    directIfJoinedWithinHours: z.number().int().min(0).max(720),
    cooldownDays: z.number().int().min(0).max(365),
    approveAfterRejectDays: z.number().int().min(0).max(90),
  }),
});

export type MembershipConfig = z.infer<typeof membershipSchema>;

const DEFAULTS: MembershipConfig = {
  joinRequestExpiryDays: 7,
  quit: {
    autoLeaveDays: 7,
    directIfJoinedWithinHours: 24,
    cooldownDays: 30,
    approveAfterRejectDays: 14,
  },
};

export async function membershipConfig(): Promise<MembershipConfig> {
  const parsed = membershipSchema.safeParse(await getConfigValue('agency'));
  if (!parsed.success) {
    logger.error('app_config.agency membership fields are invalid; using defaults', {
      issues: parsed.error.issues.length,
    });
    return DEFAULTS;
  }
  return parsed.data;
}

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface AgencyRef {
  id: string;
  publicId: number;
  name: string;
  isHouse: boolean;
}

export interface Membership {
  assignmentId: string;
  joinedAt: string;
  agency: AgencyRef;
  agent: { id: string; publicId: number; displayName: string | null };
  owner: { userId: string; publicId: number; displayName: string | null };
}

export interface AgentSeat {
  id: string;
  publicId: number;
  canManageAgents: boolean;
  isOwner: boolean;
  agency: AgencyRef;
}

export interface JoinRequestView {
  id: string;
  direction: 'host_applied' | 'agent_invited';
  status: string;
  message: string | null;
  createdAt: string;
  expiresAt: string;
  host: { userId: string; publicId: number; displayName: string | null };
  agent: { id: string; publicId: number; displayName: string | null };
  agency: AgencyRef;
}

export interface QuitRequestView {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  rejectedAt: string | null;
  resolvedAt: string | null;
  /** When a pending application lets the host go on its own (rule 1). */
  autoLeaveAt: string | null;
  /** Until when the owner may still approve a rejected one (rule 5). */
  approvableUntil: string | null;
  /** When the host may apply again (rule 4). */
  nextApplyAt: string;
  host: { userId: string; publicId: number; displayName: string | null };
}

// ── Lookups ─────────────────────────────────────────────────────────────────

type Queryable = Pick<PoolClient, 'query'>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The host's current agency, via their open agent link and that agent's open agency link. */
export async function currentMembership(
  hostUserId: string,
  db: Queryable = pool,
): Promise<Membership | null> {
  const { rows } = await db.query(
    `SELECT h.id AS assignment_id, h.effective_from,
            a.id AS agent_id, a.public_id AS agent_public_id, ap.display_name AS agent_name,
            g.id AS agency_id, g.public_id AS agency_public_id, g.name AS agency_name, g.is_house,
            g.owner_user_id, ou.public_id AS owner_public_id, op.display_name AS owner_name
       FROM host_agent_assignments h
       JOIN agents a ON a.id = h.agent_id
       JOIN agent_agency_assignments aa ON aa.agent_id = a.id AND aa.effective_to IS NULL
       JOIN agencies g ON g.id = aa.agency_id
       JOIN users ou ON ou.id = g.owner_user_id
       LEFT JOIN user_profiles ap ON ap.user_id = a.user_id
       LEFT JOIN user_profiles op ON op.user_id = g.owner_user_id
      WHERE h.host_user_id = $1 AND h.effective_to IS NULL`,
    [hostUserId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    assignmentId: r.assignment_id,
    joinedAt: r.effective_from.toISOString(),
    agency: {
      id: r.agency_id,
      publicId: Number(r.agency_public_id),
      name: r.agency_name,
      isHouse: r.is_house,
    },
    agent: {
      id: r.agent_id,
      publicId: Number(r.agent_public_id),
      displayName: r.agent_name,
    },
    owner: {
      userId: r.owner_user_id,
      publicId: Number(r.owner_public_id),
      displayName: r.owner_name,
    },
  };
}

/** The caller's agent seat, if they hold one in an active agency. */
export async function agentSeat(userId: string, db: Queryable = pool): Promise<AgentSeat | null> {
  const { rows } = await db.query(
    `SELECT a.id, a.public_id, a.can_manage_agents,
            g.id AS agency_id, g.public_id AS agency_public_id, g.name, g.is_house, g.owner_user_id
       FROM agents a
       JOIN agent_agency_assignments aa ON aa.agent_id = a.id AND aa.effective_to IS NULL
       JOIN agencies g ON g.id = aa.agency_id
      WHERE a.user_id = $1 AND a.status = 'active' AND g.status = 'active'`,
    [userId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    publicId: Number(r.public_id),
    canManageAgents: r.can_manage_agents,
    isOwner: r.owner_user_id === userId,
    agency: {
      id: r.agency_id,
      publicId: Number(r.agency_public_id),
      name: r.name,
      isHouse: r.is_house,
    },
  };
}

async function lockHost(c: PoolClient, hostUserId: string): Promise<void> {
  await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [hostUserId]);
}

// ── Host code ───────────────────────────────────────────────────────────────

// No 0/O or 1/I: a code read aloud on a call must not be ambiguous.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export async function getHostCode(userId: string): Promise<{ code: string; rotatedAt: string }> {
  // Created on first ask, so nobody has a code until they want one.
  const { rows } = await pool.query(
    `INSERT INTO host_join_codes (user_id, code) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING code, rotated_at`,
    [userId, newCode()],
  );
  return { code: rows[0].code, rotatedAt: rows[0].rotated_at.toISOString() };
}

/** A new code; every copy of the old one stops working. */
export async function rotateHostCode(userId: string): Promise<{ code: string; rotatedAt: string }> {
  const { rows } = await pool.query(
    `INSERT INTO host_join_codes (user_id, code) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code, rotated_at = now()
     RETURNING code, rotated_at`,
    [userId, newCode()],
  );
  return { code: rows[0].code, rotatedAt: rows[0].rotated_at.toISOString() };
}

// ── Join requests ───────────────────────────────────────────────────────────

const alreadyInAgency = () =>
  new AppError(
    'ALREADY_IN_AGENCY',
    'You are already in an agency. Quit it before joining another.',
    409,
  );

const unavailable = () => new AppError('AGENT_NOT_FOUND', 'No active agent has that Agent ID', 404);

async function createRequest(
  c: PoolClient,
  input: {
    hostUserId: string;
    agentId: string;
    direction: 'host_applied' | 'agent_invited';
    message?: string;
  },
): Promise<string> {
  const cfg = await membershipConfig();
  const id = uuidv7();
  const { rowCount } = await c.query(
    `INSERT INTO agency_join_requests (id, host_user_id, agent_id, direction, message, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
     ON CONFLICT (host_user_id, agent_id) WHERE status = 'pending' DO NOTHING`,
    [
      id,
      input.hostUserId,
      input.agentId,
      input.direction,
      input.message ?? null,
      cfg.joinRequestExpiryDays,
    ],
  );
  if (!rowCount) {
    throw new AppError(
      'REQUEST_ALREADY_PENDING',
      'There is already a pending request between you two',
      409,
    );
  }
  return id;
}

/** Route 1: the host typed an Agent ID (or followed an agency invite link). */
export async function applyToAgent(
  hostUserId: string,
  agentPublicId: number,
  message?: string,
): Promise<JoinRequestView> {
  const id = await withTransaction(async (c) => {
    await lockHost(c, hostUserId);
    if (await currentMembership(hostUserId, c)) throw alreadyInAgency();

    const { rows } = await c.query(
      `SELECT a.id, a.user_id FROM agents a
         JOIN agent_agency_assignments aa ON aa.agent_id = a.id AND aa.effective_to IS NULL
         JOIN agencies g ON g.id = aa.agency_id
        WHERE a.public_id = $1 AND a.status = 'active' AND g.status = 'active'`,
      [agentPublicId],
    );
    const agent = rows[0];
    if (!agent) throw unavailable();
    // A host earning commission on their own gifts is the cheapest fraud there is.
    if (agent.user_id === hostUserId) {
      throw new AppError('CANNOT_JOIN_SELF', 'You cannot join your own agent seat', 400);
    }
    return createRequest(c, {
      hostUserId,
      agentId: agent.id,
      direction: 'host_applied',
      message,
    });
  });
  return getRequestView(id);
}

/**
 * Route 2: the agent entered the host's User ID and Host Code.
 *
 * A wrong code and an unknown user get the SAME answer, so the endpoint cannot
 * be used to learn which user ids exist or to test codes one id at a time.
 */
export async function inviteHost(
  agentUserId: string,
  hostPublicId: number,
  hostCode: string,
  message?: string,
): Promise<JoinRequestView> {
  const seat = await agentSeat(agentUserId);
  if (!seat) throw new AppError('NOT_AN_AGENT', 'Only an agent can invite hosts', 403);

  const id = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT u.id FROM users u
         JOIN host_join_codes k ON k.user_id = u.id
        WHERE u.public_id = $1 AND k.code = $2 AND u.status = 'active'`,
      [hostPublicId, hostCode.toUpperCase()],
    );
    const host = rows[0];
    if (!host) {
      throw new AppError('INVITE_NOT_MATCHED', 'That User ID and Host Code do not match', 404);
    }
    if (host.id === agentUserId) {
      throw new AppError('CANNOT_JOIN_SELF', 'You cannot invite yourself', 400);
    }
    await lockHost(c, host.id);
    if (await currentMembership(host.id, c)) {
      // No poaching: a host in another agency must quit before anyone can invite them.
      throw new AppError('HOST_IN_AGENCY', 'That host is already in an agency', 409);
    }
    return createRequest(c, {
      hostUserId: host.id,
      agentId: seat.id,
      direction: 'agent_invited',
      message,
    });
  });
  return getRequestView(id);
}

const REQUEST_SELECT = `
  SELECT r.id, r.direction, r.status, r.message, r.created_at, r.expires_at,
         r.host_user_id, hu.public_id AS host_public_id, hp.display_name AS host_name,
         a.id AS agent_id, a.user_id AS agent_user_id, a.public_id AS agent_public_id,
         ap.display_name AS agent_name,
         g.id AS agency_id, g.public_id AS agency_public_id, g.name AS agency_name, g.is_house
    FROM agency_join_requests r
    JOIN users hu ON hu.id = r.host_user_id
    LEFT JOIN user_profiles hp ON hp.user_id = r.host_user_id
    JOIN agents a ON a.id = r.agent_id
    LEFT JOIN user_profiles ap ON ap.user_id = a.user_id
    LEFT JOIN agent_agency_assignments aa ON aa.agent_id = a.id AND aa.effective_to IS NULL
    LEFT JOIN agencies g ON g.id = aa.agency_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRequestView(r: any): JoinRequestView {
  return {
    id: r.id,
    direction: r.direction,
    // Expiry is evaluated on read, so a request is never shown as live past it
    // even before the sweep job closes it.
    status: r.status === 'pending' && r.expires_at <= new Date() ? 'expired' : r.status,
    message: r.message,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    host: {
      userId: r.host_user_id,
      publicId: Number(r.host_public_id),
      displayName: r.host_name,
    },
    agent: {
      id: r.agent_id,
      publicId: Number(r.agent_public_id),
      displayName: r.agent_name,
    },
    agency: {
      id: r.agency_id,
      publicId: Number(r.agency_public_id),
      name: r.agency_name,
      isHouse: Boolean(r.is_house),
    },
  };
}

async function getRequestView(id: string): Promise<JoinRequestView> {
  const { rows } = await pool.query(`${REQUEST_SELECT} WHERE r.id = $1`, [id]);
  return toRequestView(rows[0]);
}

/** Pending requests the caller can act on or withdraw — as a host and as an agent. */
export async function listRequests(userId: string): Promise<{
  asHost: JoinRequestView[];
  asAgent: JoinRequestView[];
}> {
  const { rows } = await pool.query(
    `${REQUEST_SELECT}
      WHERE r.status = 'pending' AND r.expires_at > now()
        AND (r.host_user_id = $1 OR a.user_id = $1)
      ORDER BY r.created_at DESC
      LIMIT 100`,
    [userId],
  );
  return {
    asHost: rows.filter((r) => r.host_user_id === userId).map(toRequestView),
    asAgent: rows.filter((r) => r.agent_user_id === userId).map(toRequestView),
  };
}

const requestNotFound = () => new AppError('REQUEST_NOT_FOUND', 'That request does not exist', 404);
const requestClosed = () => new AppError('REQUEST_CLOSED', 'That request is no longer open', 409);

/**
 * Accept or decline. Only the side that did NOT start the request may answer:
 * the agent answers an application, the host answers an invite.
 */
export async function answerRequest(
  userId: string,
  requestId: string,
  accept: boolean,
): Promise<{ request: JoinRequestView; membership: Membership | null }> {
  await withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT r.id, r.host_user_id, r.agent_id, r.direction, r.status, r.expires_at <= now() AS expired,
              a.user_id AS agent_user_id
         FROM agency_join_requests r JOIN agents a ON a.id = r.agent_id
        WHERE r.id = $1`,
      [requestId],
    );
    const r = rows[0];
    const answerer = r?.direction === 'host_applied' ? r.agent_user_id : r?.host_user_id;
    // Someone who is not a party gets "not found", not "forbidden": the id of a
    // request between two other people is not theirs to confirm.
    if (!r || answerer !== userId) throw requestNotFound();

    await lockHost(c, r.host_user_id);
    const { rows: fresh } = await c.query(
      'SELECT status FROM agency_join_requests WHERE id = $1 FOR UPDATE',
      [requestId],
    );
    if (fresh[0].status !== 'pending') throw requestClosed();
    if (r.expired) {
      await c.query(
        "UPDATE agency_join_requests SET status = 'expired', decided_at = now() WHERE id = $1",
        [requestId],
      );
      throw requestClosed();
    }

    if (!accept) {
      await c.query(
        "UPDATE agency_join_requests SET status = 'declined', decided_at = now(), decided_by = $2 WHERE id = $1",
        [requestId, userId],
      );
      return;
    }

    if (await currentMembership(r.host_user_id, c)) {
      throw r.direction === 'agent_invited'
        ? alreadyInAgency()
        : new AppError('HOST_IN_AGENCY', 'That host has joined another agency', 409);
    }
    const seat = await agentSeat(r.agent_user_id, c);
    if (!seat)
      throw new AppError('AGENCY_UNAVAILABLE', 'That agency is not accepting hosts right now', 409);

    await c.query(
      "UPDATE agency_join_requests SET status = 'accepted', decided_at = now(), decided_by = $2 WHERE id = $1",
      [requestId, userId],
    );
    await c.query(
      `INSERT INTO host_agent_assignments (id, host_user_id, agent_id, join_request_id)
       VALUES ($1, $2, $3, $4)`,
      [uuidv7(), r.host_user_id, r.agent_id, requestId],
    );
    // Every other open request for this host is moot now.
    await c.query(
      `UPDATE agency_join_requests SET status = 'cancelled', decided_at = now()
        WHERE host_user_id = $1 AND status = 'pending' AND id <> $2`,
      [r.host_user_id, requestId],
    );
  });

  const request = await getRequestView(requestId);
  return {
    request,
    membership: accept ? await currentMembership(request.host.userId) : null,
  };
}

/** Withdraw a request you started. */
export async function cancelRequest(userId: string, requestId: string): Promise<JoinRequestView> {
  const { rows } = await pool.query(
    `SELECT r.status, r.direction, r.host_user_id, a.user_id AS agent_user_id
       FROM agency_join_requests r JOIN agents a ON a.id = r.agent_id WHERE r.id = $1`,
    [requestId],
  );
  const r = rows[0];
  const starter = r?.direction === 'host_applied' ? r.host_user_id : r?.agent_user_id;
  if (!r || starter !== userId) throw requestNotFound();

  const { rowCount } = await pool.query(
    `UPDATE agency_join_requests SET status = 'cancelled', decided_at = now(), decided_by = $2
      WHERE id = $1 AND status = 'pending'`,
    [requestId, userId],
  );
  if (!rowCount) throw requestClosed();
  return getRequestView(requestId);
}

// ── Quitting ────────────────────────────────────────────────────────────────

async function endAssignment(
  c: PoolClient,
  assignmentId: string,
  by: string | null,
  reason: string,
) {
  await c.query(
    `UPDATE host_agent_assignments SET effective_to = now(), ended_by = $2, end_reason = $3
      WHERE id = $1 AND effective_to IS NULL`,
    [assignmentId, by, reason],
  );
}

const QUIT_SELECT = `
  SELECT q.id, q.status, q.reason, q.created_at, q.rejected_at, q.resolved_at,
         q.host_user_id, u.public_id AS host_public_id, p.display_name AS host_name
    FROM agency_quit_requests q
    JOIN users u ON u.id = q.host_user_id
    LEFT JOIN user_profiles p ON p.user_id = q.host_user_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toQuitView(r: any, cfg: MembershipConfig): QuitRequestView {
  const days = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
  return {
    id: r.id,
    status: r.status,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
    rejectedAt: iso(r.rejected_at),
    resolvedAt: iso(r.resolved_at),
    autoLeaveAt:
      r.status === 'pending' ? days(r.created_at, cfg.quit.autoLeaveDays).toISOString() : null,
    approvableUntil:
      r.status === 'rejected'
        ? days(r.rejected_at, cfg.quit.approveAfterRejectDays).toISOString()
        : null,
    nextApplyAt: days(r.created_at, cfg.quit.cooldownDays).toISOString(),
    host: {
      userId: r.host_user_id,
      publicId: Number(r.host_public_id),
      displayName: r.host_name,
    },
  };
}

async function getQuitView(id: string): Promise<QuitRequestView> {
  const [cfg, { rows }] = await Promise.all([
    membershipConfig(),
    pool.query(`${QUIT_SELECT} WHERE q.id = $1`, [id]),
  ]);
  return toQuitView(rows[0], cfg);
}

/** The host's latest application, for the My Agency screen. */
export async function latestQuitRequest(hostUserId: string): Promise<QuitRequestView | null> {
  const [cfg, { rows }] = await Promise.all([
    membershipConfig(),
    pool.query(`${QUIT_SELECT} WHERE q.host_user_id = $1 ORDER BY q.created_at DESC LIMIT 1`, [
      hostUserId,
    ]),
  ]);
  return rows[0] ? toQuitView(rows[0], cfg) : null;
}

/**
 * Apply to leave. Returns 'left' when rule 2 or 3 lets the host go at once,
 * otherwise 'pending' until the owner decides or 7 days pass.
 */
export async function applyToQuit(
  hostUserId: string,
  reason: string,
): Promise<{ outcome: 'left' | 'pending'; request: QuitRequestView }> {
  const cfg = await membershipConfig();

  const result = await withTransaction(async (c) => {
    await lockHost(c, hostUserId);
    const membership = await currentMembership(hostUserId, c);
    if (!membership) throw new AppError('NOT_IN_AGENCY', 'You are not in an agency', 409);

    const { rows: last } = await c.query(
      `SELECT status, created_at, created_at + make_interval(days => $2) AS next_allowed_at
         FROM agency_quit_requests WHERE host_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [hostUserId, cfg.quit.cooldownDays],
    );
    if (last[0]?.status === 'pending') {
      throw new AppError(
        'QUIT_ALREADY_PENDING',
        'Your application to leave is already waiting',
        409,
      );
    }
    // Rule 4: one application per cooldown window, whatever became of the last.
    if (last[0] && last[0].next_allowed_at > new Date()) {
      throw new AppError('QUIT_COOLDOWN', 'You can apply to leave again later', 409, {
        nextAllowedAt: last[0].next_allowed_at.toISOString(),
      });
    }

    const { rows: facts } = await c.query(
      `SELECT u.face_auth_attempted_at IS NULL AS never_face_authed,
              h.effective_from > now() - make_interval(hours => $3) AS joined_recently
         FROM users u, host_agent_assignments h
        WHERE u.id = $1 AND h.id = $2`,
      [hostUserId, membership.assignmentId, cfg.quit.directIfJoinedWithinHours],
    );
    // Rules 2 and 3.
    const direct = facts[0].never_face_authed || facts[0].joined_recently;

    const id = uuidv7();
    await c.query(
      `INSERT INTO agency_quit_requests
         (id, host_user_id, host_assignment_id, agency_id, reason, status, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'direct' THEN now() END)`,
      [
        id,
        hostUserId,
        membership.assignmentId,
        membership.agency.id,
        reason,
        direct ? 'direct' : 'pending',
      ],
    );
    if (direct) await endAssignment(c, membership.assignmentId, hostUserId, 'quit_direct');
    return { id, direct };
  });

  return {
    outcome: result.direct ? 'left' : 'pending',
    request: await getQuitView(result.id),
  };
}

/** The owner's inbox: pending applications, and rejected ones still approvable. */
export async function listQuitRequests(ownerUserId: string): Promise<QuitRequestView[]> {
  const seat = await agentSeat(ownerUserId);
  if (!seat?.isOwner) throw notOwner();
  const cfg = await membershipConfig();
  const { rows } = await pool.query(
    `${QUIT_SELECT}
      WHERE q.agency_id = $1
        AND (q.status = 'pending'
             OR (q.status = 'rejected' AND q.rejected_at > now() - make_interval(days => $2)))
      ORDER BY q.created_at
      LIMIT 200`,
    [seat.agency.id, cfg.quit.approveAfterRejectDays],
  );
  return rows.map((r) => toQuitView(r, cfg));
}

const notOwner = () =>
  new AppError('NOT_AGENCY_OWNER', 'Only the agency owner can decide applications to leave', 403);

/**
 * The owner approves or rejects. A rejected application can still be approved
 * within the window (rule 5); it cannot be rejected twice, and a decided one
 * cannot be reopened.
 */
export async function decideQuit(
  ownerUserId: string,
  requestId: string,
  approve: boolean,
): Promise<QuitRequestView> {
  const cfg = await membershipConfig();
  await withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT q.host_user_id, q.agency_id, g.owner_user_id
         FROM agency_quit_requests q JOIN agencies g ON g.id = q.agency_id WHERE q.id = $1`,
      [requestId],
    );
    const q = rows[0];
    if (!q) throw new AppError('REQUEST_NOT_FOUND', 'That application does not exist', 404);
    if (q.owner_user_id !== ownerUserId) throw notOwner();

    await lockHost(c, q.host_user_id);
    const { rows: fresh } = await c.query(
      `SELECT status, host_assignment_id,
              rejected_at > now() - make_interval(days => $2) AS within_window
         FROM agency_quit_requests WHERE id = $1 FOR UPDATE`,
      [requestId, cfg.quit.approveAfterRejectDays],
    );
    const { status, host_assignment_id, within_window } = fresh[0];

    if (status === 'pending' && !approve) {
      await c.query(
        "UPDATE agency_quit_requests SET status = 'rejected', rejected_at = now(), rejected_by = $2 WHERE id = $1",
        [requestId, ownerUserId],
      );
      return;
    }
    if (approve && (status === 'pending' || (status === 'rejected' && within_window))) {
      await c.query(
        "UPDATE agency_quit_requests SET status = 'approved', resolved_at = now(), resolved_by = $2 WHERE id = $1",
        [requestId, ownerUserId],
      );
      await endAssignment(c, host_assignment_id, ownerUserId, 'quit_approved');
      return;
    }
    throw new AppError('QUIT_DECISION_CLOSED', 'That application can no longer be changed', 409);
  });
  return getQuitView(requestId);
}

// ── Sweeps (workers) ────────────────────────────────────────────────────────

/** Rule 1: an application left undecided for the window lets the host go. */
export async function autoLeaveOverdue(): Promise<number> {
  const cfg = await membershipConfig();
  const { rows } = await pool.query(
    `SELECT id, host_user_id, host_assignment_id FROM agency_quit_requests
      WHERE status = 'pending' AND created_at <= now() - make_interval(days => $1)
      ORDER BY created_at LIMIT 500`,
    [cfg.quit.autoLeaveDays],
  );
  let done = 0;
  for (const q of rows) {
    await withTransaction(async (c) => {
      await lockHost(c, q.host_user_id);
      const { rowCount } = await c.query(
        `UPDATE agency_quit_requests SET status = 'auto_left', resolved_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [q.id],
      );
      if (rowCount) {
        await endAssignment(c, q.host_assignment_id, null, 'quit_auto');
        done++;
      }
    });
  }
  return done;
}

/** Closes join requests past their expiry, so the pending index stays honest. */
export async function expireJoinRequests(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE agency_join_requests SET status = 'expired', decided_at = now()
      WHERE status = 'pending' AND expires_at <= now()`,
  );
  return rowCount ?? 0;
}
