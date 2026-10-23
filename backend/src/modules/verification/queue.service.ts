// What the moderator sees, and what happens when they decide.
//
// Two queues, one surface: the one-time onboarding photos and the frames
// captured at go-live. A reviewer does the same thing with both — look at a
// face, compare it to what we have, decide.

import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { publicUrlFor } from '../media/index.js';

export interface PendingVerification {
  userId: string;
  publicId: number;
  displayName: string | null;
  faceUrl: string | null;
  submittedAt: string;
  /** How long they have been waiting. The reason the queue is oldest-first. */
  waitingHours: number;
}

export interface PendingFaceCheck {
  id: string;
  userId: string;
  publicId: number;
  displayName: string | null;
  roomId: string;
  roomPublicId: number;
  roomTitle: string;
  /** The frame captured as they went live. */
  faceUrl: string | null;
  /** The approved onboarding photo, to compare against. Null if never verified. */
  referenceUrl: string | null;
  reason: string;
  deviceId: string | null;
  at: string;
  /** Whether that room is still broadcasting — decides if "end room" is useful. */
  live: boolean;
  flagged: boolean;
  suspended: boolean;
}

/** Onboarding photos waiting on a human. Oldest first. */
export async function pendingVerifications(limit = 50): Promise<PendingVerification[]> {
  const { rows } = await pool.query<{
    user_id: string;
    public_id: string;
    display_name: string | null;
    face_key: string;
    submitted_at: Date;
  }>(
    `SELECT v.user_id, u.public_id, p.display_name, v.face_key, v.submitted_at
       FROM host_verifications v
       JOIN users u ON u.id = v.user_id
       LEFT JOIN user_profiles p ON p.user_id = v.user_id
      WHERE v.status = 'pending'
      ORDER BY v.submitted_at
      LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    userId: row.user_id,
    publicId: Number(row.public_id),
    displayName: row.display_name,
    faceUrl: publicUrlFor(row.face_key),
    submittedAt: row.submitted_at.toISOString(),
    waitingHours: Math.floor((Date.now() - row.submitted_at.getTime()) / 3_600_000),
  }));
}

/**
 * Go-live frames waiting on a human, newest first.
 *
 * Newest first here, unlike the onboarding queue — a frame from a stream
 * happening RIGHT NOW is the one where ending the room is still an option. An
 * hour-old frame can only lead to a suspension, which does not get better for
 * being decided sooner.
 */
export async function pendingFaceChecks(limit = 50): Promise<PendingFaceCheck[]> {
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    public_id: string;
    display_name: string | null;
    room_id: string;
    room_public_id: string;
    room_title: string;
    face_key: string;
    reference_key: string | null;
    reason: string;
    device_id: string | null;
    created_at: Date;
    live: boolean;
    flagged: boolean;
    suspended: boolean;
  }>(
    `SELECT f.id, f.user_id, u.public_id, p.display_name,
            f.room_id, r.public_id AS room_public_id, r.title AS room_title,
            f.face_key,
            -- Only an APPROVED photo is a reference. Comparing against one a
            -- human has not accepted would launder an unreviewed face into the
            -- thing everything else is checked against.
            (CASE WHEN v.status = 'approved' THEN v.face_key END) AS reference_key,
            f.reason, f.device_id, f.created_at,
            (r.ended_at IS NULL) AS live,
            (u.host_flagged_at IS NOT NULL) AS flagged,
            (u.host_suspended_at IS NOT NULL) AS suspended
       FROM face_checks f
       JOIN users u ON u.id = f.user_id
       JOIN rooms r ON r.id = f.room_id
       LEFT JOIN user_profiles p ON p.user_id = f.user_id
       LEFT JOIN host_verifications v ON v.user_id = f.user_id
      WHERE f.status = 'pending'
      ORDER BY f.created_at DESC
      LIMIT $1`,
    [limit],
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    publicId: Number(row.public_id),
    displayName: row.display_name,
    roomId: row.room_id,
    roomPublicId: Number(row.room_public_id),
    roomTitle: row.room_title,
    faceUrl: publicUrlFor(row.face_key),
    referenceUrl: row.reference_key === null ? null : publicUrlFor(row.reference_key),
    reason: row.reason,
    deviceId: row.device_id,
    at: row.created_at.toISOString(),
    live: row.live,
    flagged: row.flagged,
    suspended: row.suspended,
  }));
}

/** Approve or reject an onboarding photo. */
export async function decideVerification(input: {
  userId: string;
  reviewerId: string;
  approve: boolean;
  note?: string;
}): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE host_verifications
        SET status = $2, reviewed_by = $3, reviewed_at = now(), reviewer_note = $4
      WHERE user_id = $1 AND status = 'pending'`,
    [input.userId, input.approve ? 'approved' : 'rejected', input.reviewerId, input.note ?? null],
  );
  if (rowCount === 0) {
    throw new AppError('VERIFICATION_NOT_PENDING', 'That submission was already decided', 409);
  }
}

/**
 * Decide a go-live frame.
 *
 * `ok` and `unclear` both close the row — a frame too dark to judge is not
 * evidence of anything, and leaving it open would grow a queue of things
 * nobody can decide. `unclear` is recorded separately from `ok` so a host whose
 * frames are repeatedly unreadable is visible as a pattern rather than passing
 * silently.
 *
 * This writes NO enforcement action. Deciding what a mismatch means is a
 * separate, logged choice — see `enforcement.service.ts`.
 */
export async function decideFaceCheck(input: {
  checkId: string;
  reviewerId: string;
  status: 'ok' | 'mismatch' | 'unclear';
}): Promise<{ userId: string; roomId: string }> {
  const { rows } = await pool.query<{ user_id: string; room_id: string }>(
    `UPDATE face_checks
        SET status = $2, reviewed_by = $3, reviewed_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING user_id, room_id`,
    [input.checkId, input.status, input.reviewerId],
  );
  const row = rows[0];
  if (!row) throw new AppError('CHECK_NOT_PENDING', 'That check was already decided', 409);
  return { userId: row.user_id, roomId: row.room_id };
}

/** How much is waiting. Drives the counts on the panel's front page. */
export async function queueCounts(): Promise<{
  verifications: number;
  faceChecks: number;
  reports: number;
  appeals: number;
}> {
  const { rows } = await pool.query<{
    verifications: string;
    face_checks: string;
    reports: string;
    appeals: string;
  }>(
    `SELECT
       (SELECT count(*) FROM host_verifications WHERE status = 'pending') AS verifications,
       (SELECT count(*) FROM face_checks WHERE status = 'pending') AS face_checks,
       (SELECT count(*) FROM reports WHERE status = 'open') AS reports,
       (SELECT count(*) FROM appeals WHERE status = 'open') AS appeals`,
  );
  return {
    verifications: Number(rows[0]?.verifications ?? 0),
    faceChecks: Number(rows[0]?.face_checks ?? 0),
    reports: Number(rows[0]?.reports ?? 0),
    appeals: Number(rows[0]?.appeals ?? 0),
  };
}
