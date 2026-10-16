// Host verification: the one-time check, and the frame captured at every
// go-live.
//
// Read migration 031's header for why going live is NOT gated on the frame.
// The short version: a gate fails on real hosts in bad light, and the payout
// hold means an hour-late catch is early enough.

import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { getConfigValue } from '../economy/index.js';
import { claimUpload } from '../media/index.js';

const schema = z.object({
  faceCheckOnGoLive: z.boolean(),
  staleAfterHours: z.number().int().min(1).max(720),
  samplePercent: z.number().int().min(0).max(100),
  requireApprovedToGoLive: z.boolean(),
});

export type VerificationConfig = z.infer<typeof schema>;

/**
 * Off, and permissive, when the row is missing or malformed.
 *
 * Deliberately the opposite default to PK's. A typo in this row must not stop
 * every host on the platform going live — the cost of capturing nothing for an
 * hour is a gap in a review queue; the cost of gating wrongly is the whole
 * product stopping.
 */
const SAFE: VerificationConfig = {
  faceCheckOnGoLive: false,
  staleAfterHours: 24,
  samplePercent: 10,
  requireApprovedToGoLive: false,
};

export async function verificationConfig(): Promise<VerificationConfig> {
  const parsed = schema.safeParse(await getConfigValue('verification'));
  return parsed.success ? parsed.data : SAFE;
}

// ---------------------------------------------------------------------------
// The one-time check
// ---------------------------------------------------------------------------

export interface HostVerification {
  status: 'none' | 'pending' | 'approved' | 'rejected' | 'expired';
  submittedAt: string | null;
  reviewedAt: string | null;
  /** Shown to the host on a rejection so they know what to fix. */
  note: string | null;
}

export async function verificationFor(userId: string): Promise<HostVerification> {
  const { rows } = await pool.query<{
    status: string;
    submitted_at: Date;
    reviewed_at: Date | null;
    reviewer_note: string | null;
  }>(
    'SELECT status, submitted_at, reviewed_at, reviewer_note FROM host_verifications WHERE user_id = $1',
    [userId],
  );

  const row = rows[0];
  if (!row) return { status: 'none', submittedAt: null, reviewedAt: null, note: null };

  return {
    status: row.status as HostVerification['status'],
    submittedAt: row.submitted_at.toISOString(),
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    note: row.reviewer_note,
  };
}

/**
 * Submit, or re-submit after a rejection.
 *
 * `claimUpload` is what proves the key is a real object under this user's own
 * prefix — the same guard avatars and room covers use, and the reason a client
 * can never name an arbitrary key here.
 *
 * Re-submitting while PENDING is refused: it would push the host to the back of
 * a queue they are already in, which looks like progress and is the opposite.
 */
export async function submitVerification(userId: string, faceKey: string): Promise<HostVerification> {
  const claimed = await claimUpload(userId, 'avatar', faceKey);

  const current = await verificationFor(userId);
  if (current.status === 'pending') {
    throw new AppError('VERIFICATION_PENDING', 'Your photo is already being reviewed', 409);
  }
  if (current.status === 'approved') {
    throw new AppError('VERIFICATION_DONE', 'You are already verified', 409);
  }

  await pool.query(
    `INSERT INTO host_verifications (user_id, face_key, status, submitted_at)
          VALUES ($1, $2, 'pending', now())
     ON CONFLICT (user_id) DO UPDATE
        SET face_key = EXCLUDED.face_key,
            status = 'pending',
            submitted_at = now(),
            -- A fresh submission is undecided again, and the constraint
            -- requires the decider to go with the decision.
            reviewed_by = NULL,
            reviewed_at = NULL,
            reviewer_note = NULL`,
    [userId, claimed.key],
  );

  logger.info('verification submitted', { user_id: userId });
  return verificationFor(userId);
}

// ---------------------------------------------------------------------------
// The frame captured at every go-live
// ---------------------------------------------------------------------------

export type CheckReason = 'new_device' | 'stale' | 'flagged' | 'sample';

/**
 * Should this go-live's frame be queued for a human?
 *
 * Not every one. A host streaming four times a day does not need four reviews,
 * and a queue nobody can finish is a queue nobody reads. The four rules
 * together mean a handoff is caught within a day at the latest, and cannot be
 * waited out — the random slice is what stops somebody learning the pattern.
 *
 * Returns null when this one is not worth a reviewer's time.
 */
export async function reasonToReview(input: {
  userId: string;
  deviceId: string | null;
  config: VerificationConfig;
}): Promise<CheckReason | null> {
  const { rows } = await pool.query<{
    flagged: boolean;
    last_ok: Date | null;
    seen_device: boolean;
  }>(
    `SELECT
       (u.host_flagged_at IS NOT NULL) AS flagged,
       (SELECT max(reviewed_at) FROM face_checks
         WHERE user_id = $1 AND status = 'ok') AS last_ok,
       EXISTS (SELECT 1 FROM face_checks
                WHERE user_id = $1 AND device_id IS NOT DISTINCT FROM $2) AS seen_device
     FROM users u WHERE u.id = $1`,
    [input.userId, input.deviceId],
  );

  const row = rows[0];
  if (!row) return null;

  // Ordered by how much a reviewer learns from it. A flagged account is the
  // reason the flag exists; a new device is the strongest handoff signal there
  // is; staleness is the routine sweep; the sample is the backstop.
  if (row.flagged) return 'flagged';
  if (!row.seen_device) return 'new_device';

  const staleMs = input.config.staleAfterHours * 3_600_000;
  if (row.last_ok === null || Date.now() - row.last_ok.getTime() > staleMs) return 'stale';

  if (Math.random() * 100 < input.config.samplePercent) return 'sample';
  return null;
}

/**
 * Record the frame captured as a host went live.
 *
 * Called from `goLive` AFTER the room exists, and never able to stop it. A
 * missing frame is a gap in a review queue; a failed go-live is a host who
 * cannot earn, and this is not important enough to be the cause of that.
 */
export async function recordFaceCheck(
  client: PoolClient,
  input: { userId: string; roomId: string; faceKey: string; reason: CheckReason; deviceId: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO face_checks (id, user_id, room_id, face_key, reason, device_id)
          VALUES ($1, $2, $3, $4, $5, $6)`,
    [uuidv7(), input.userId, input.roomId, input.faceKey, input.reason, input.deviceId],
  );
}

/**
 * Whether this host may go live at all.
 *
 * Suspension is the only hard stop. `requireApprovedToGoLive` is a dial that is
 * FALSE for the beta: the seeded hosts are onboarded by hand, and gating them
 * on a queue nobody is watching yet would stop the platform before it starts.
 */
export async function assertMayGoLive(userId: string): Promise<void> {
  const config = await verificationConfig();

  const { rows } = await pool.query<{ suspended: Date | null; status: string | null }>(
    `SELECT u.host_suspended_at AS suspended, v.status
       FROM users u
       LEFT JOIN host_verifications v ON v.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];

  if (row?.suspended) {
    throw new AppError('HOST_SUSPENDED', 'Your account cannot go live. Contact support.', 403);
  }
  if (config.requireApprovedToGoLive && row?.status !== 'approved') {
    throw new AppError('VERIFICATION_REQUIRED', 'Verify your photo before going live', 403);
  }
}
