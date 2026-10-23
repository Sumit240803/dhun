// Appeals — a suspended host asks a second person to look.
//
// Three rules, each the kind that is easy to lose in a refactor:
//
//   1. One appeal per suspension. The suspension is an enforcement_actions
//      row and `appeals.action_id` is UNIQUE on it.
//   2. The reviewer is never the person who suspended them. Checked here, and
//      both ids are kept so it can be audited.
//   3. Lifting the suspension goes through `enforce()` like every other change
//      to a host's standing, with `source = 'appeal'` — so the log says WHY.
//
// The suspension note a moderator wrote is NOT shown to the host; it was
// written for the log. The appeal note is — it is written for them.

import { uuidv7 } from 'uuidv7';
import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { enforce } from './enforcement.service.js';

export type AppealStatus = 'open' | 'upheld' | 'overturned';

export interface MyAppeal {
  /** Whether the account cannot go live right now. */
  suspended: boolean;
  suspendedAt: string | null;
  /** The appeal against the CURRENT suspension, if one was filed. */
  appeal: {
    id: string;
    status: AppealStatus;
    message: string;
    createdAt: string;
    reviewedAt: string | null;
    note: string | null;
  } | null;
}

/** The most recent suspension of this host, whether or not it has since been lifted. */
async function latestSuspension(userId: string): Promise<{ id: string; at: Date; actorId: string } | null> {
  const { rows } = await pool.query<{ id: string; created_at: Date; actor_id: string }>(
    `SELECT id, created_at, actor_id FROM enforcement_actions
      WHERE subject_type = 'user' AND subject_id = $1 AND action = 'suspend'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0] ? { id: rows[0].id, at: rows[0].created_at, actorId: rows[0].actor_id } : null;
}

export async function myAppeal(userId: string): Promise<MyAppeal> {
  const { rows } = await pool.query<{ host_suspended_at: Date | null }>(
    'SELECT host_suspended_at FROM users WHERE id = $1',
    [userId],
  );
  const suspendedAt = rows[0]?.host_suspended_at ?? null;
  const suspension = await latestSuspension(userId);
  if (!suspension) return { suspended: suspendedAt !== null, suspendedAt: null, appeal: null };

  const appeal = await pool.query<{
    id: string;
    status: AppealStatus;
    message: string;
    created_at: Date;
    reviewed_at: Date | null;
    reviewer_note: string | null;
  }>(
    'SELECT id, status, message, created_at, reviewed_at, reviewer_note FROM appeals WHERE action_id = $1',
    [suspension.id],
  );
  const row = appeal.rows[0];

  return {
    suspended: suspendedAt !== null,
    suspendedAt: suspendedAt?.toISOString() ?? suspension.at.toISOString(),
    appeal: row
      ? {
          id: row.id,
          status: row.status,
          message: row.message,
          createdAt: row.created_at.toISOString(),
          reviewedAt: row.reviewed_at?.toISOString() ?? null,
          note: row.reviewer_note,
        }
      : null,
  };
}

export async function fileAppeal(userId: string, rawMessage: string): Promise<MyAppeal> {
  const message = rawMessage.trim().replace(/\s+/g, ' ');
  if (message.length < 20) {
    throw new AppError('APPEAL_TOO_SHORT', 'Tell us a little more — at least a sentence', 422);
  }

  const { rows } = await pool.query<{ host_suspended_at: Date | null }>(
    'SELECT host_suspended_at FROM users WHERE id = $1',
    [userId],
  );
  if (rows[0]?.host_suspended_at == null) {
    throw new AppError('NOT_SUSPENDED', 'Your account is not suspended', 409);
  }

  const suspension = await latestSuspension(userId);
  if (!suspension) {
    // Suspended on the user row with no log entry behind it should not be
    // possible; if it ever is, the host must still be able to be heard.
    throw new AppError('NOT_SUSPENDED', 'Your account is not suspended', 409);
  }

  const existing = await pool.query<{ status: AppealStatus }>(
    'SELECT status FROM appeals WHERE action_id = $1',
    [suspension.id],
  );
  if (existing.rows[0]) {
    throw existing.rows[0].status === 'open'
      ? new AppError('APPEAL_PENDING', 'Your appeal is already being reviewed', 409)
      : new AppError('APPEAL_DECIDED', 'This suspension has already been reviewed', 409);
  }

  await pool.query(
    'INSERT INTO appeals (id, user_id, action_id, message) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [uuidv7(), userId, suspension.id, message.slice(0, 1000)],
  );
  return myAppeal(userId);
}

// ── The queue ───────────────────────────────────────────────────────────────

export interface OpenAppeal {
  id: string;
  userId: string;
  displayName: string | null;
  publicId: string;
  message: string;
  at: string;
  /** The suspension being appealed. */
  suspension: { at: string; actorId: string; actorName: string | null; note: string | null; source: string };
}

export async function openAppeals(): Promise<OpenAppeal[]> {
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    display_name: string | null;
    public_id: string;
    message: string;
    created_at: Date;
    s_at: Date;
    actor_id: string;
    actor_name: string | null;
    s_note: string | null;
    s_source: string;
  }>(
    `SELECT a.id, a.user_id, p.display_name, u.public_id, a.message, a.created_at,
            e.created_at AS s_at, e.actor_id, ap.display_name AS actor_name, e.note AS s_note,
            e.source AS s_source
       FROM appeals a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       JOIN enforcement_actions e ON e.id = a.action_id
       LEFT JOIN user_profiles ap ON ap.user_id = e.actor_id
      WHERE a.status = 'open'
      ORDER BY a.created_at ASC`,
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    publicId: String(row.public_id),
    message: row.message,
    at: row.created_at.toISOString(),
    suspension: {
      at: row.s_at.toISOString(),
      actorId: row.actor_id,
      actorName: row.actor_name,
      note: row.s_note,
      source: row.s_source,
    },
  }));
}

export async function openAppealCount(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM appeals WHERE status = 'open'",
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Decide. Overturning lifts the suspension through `enforce()` FIRST — if that
 * fails the appeal stays open and visible rather than reading as granted with
 * the host still locked out.
 */
export async function decideAppeal(input: {
  appealId: string;
  reviewerId: string;
  outcome: 'upheld' | 'overturned';
  note?: string;
}): Promise<void> {
  const { rows } = await pool.query<{ user_id: string; actor_id: string; status: AppealStatus }>(
    `SELECT a.user_id, e.actor_id, a.status
       FROM appeals a JOIN enforcement_actions e ON e.id = a.action_id
      WHERE a.id = $1`,
    [input.appealId],
  );
  const appeal = rows[0];
  if (!appeal || appeal.status !== 'open') {
    throw new AppError('APPEAL_NOT_FOUND', 'That appeal is not open', 404);
  }
  if (appeal.actor_id === input.reviewerId) {
    throw new AppError(
      'APPEAL_SAME_REVIEWER',
      'An appeal is decided by someone other than the person who suspended the host',
      403,
    );
  }

  const note = input.note?.trim().slice(0, 500) || null;

  if (input.outcome === 'overturned') {
    await enforce({
      actorId: input.reviewerId,
      action: 'unsuspend',
      subjectType: 'user',
      subjectId: appeal.user_id,
      source: 'appeal',
      sourceId: input.appealId,
      note: note ?? undefined,
    });
  }

  await pool.query(
    `UPDATE appeals SET status = $2, reviewer_id = $3, reviewed_at = now(), reviewer_note = $4
      WHERE id = $1 AND status = 'open'`,
    [input.appealId, input.outcome, input.reviewerId, note],
  );
}
