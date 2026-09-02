import { uuidv7 } from 'uuidv7';
import { AppError } from '../../infra/errors.js';
import { pool } from '../../infra/db.js';

export const REPORT_REASONS = [
  'nudity',
  'harassment',
  'hate',
  'violence',
  'self_harm',
  'minor',
  'scam',
  'spam',
  'impersonation',
  'illegal',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
export type SubjectType = 'user' | 'room' | 'message';

/**
 * Files a report.
 *
 * Deliberately NOT deduplicated across reporters: twenty people reporting the
 * same host is the strongest signal moderation has. It IS deduplicated per
 * reporter per day, so one person cannot manufacture that signal alone.
 *
 * A repeat within the same day succeeds silently rather than erroring. The user
 * did the right thing twice; telling them off for it teaches them not to report.
 */
export async function fileReport(input: {
  reporterId: string;
  subjectType: SubjectType;
  subjectId: string;
  reason: ReportReason;
  detail?: string;
}): Promise<{ filed: boolean }> {
  if (input.subjectType === 'user' && input.subjectId === input.reporterId) {
    throw new AppError('CANNOT_REPORT_SELF', 'You cannot report yourself', 422);
  }

  const exists = await subjectExists(input.subjectType, input.subjectId);
  if (!exists) {
    throw new AppError('SUBJECT_NOT_FOUND', 'That content no longer exists', 404);
  }

  const { rowCount } = await pool.query(
    `INSERT INTO reports (id, reporter_user_id, subject_type, subject_id, reason, detail)
          VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [uuidv7(), input.reporterId, input.subjectType, input.subjectId, input.reason, input.detail ?? null],
  );

  return { filed: (rowCount ?? 0) > 0 };
}

async function subjectExists(type: SubjectType, id: string): Promise<boolean> {
  // A fixed table per type rather than a dynamic identifier — the subject type
  // arrives from the client, and building SQL from it would be an injection
  // waiting for a validator to be relaxed.
  const table = type === 'user' ? 'users' : type === 'room' ? 'rooms' : 'messages';
  const { rowCount } = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Blocks someone.
 *
 * Idempotent, and it does NOT unfollow. Those are separate intentions: a user
 * who blocks then unblocks should not silently lose a follow they chose.
 */
export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  if (blockerId === blockedId) {
    throw new AppError('CANNOT_BLOCK_SELF', 'You cannot block yourself', 422);
  }

  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE id = $1', [blockedId]);
  if (rowCount === 0) {
    throw new AppError('USER_NOT_FOUND', 'That account does not exist', 404);
  }

  await pool.query(
    'INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [blockerId, blockedId],
  );
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await pool.query('DELETE FROM blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2', [
    blockerId,
    blockedId,
  ]);
}

/**
 * Is there a block in EITHER direction?
 *
 * Both directions on purpose. If A blocks B, B must not be able to open A's
 * profile or walk into A's room either — a one-way block that leaves the
 * blocked person able to watch is not a block, it is a mute.
 */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM blocks
      WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
         OR (blocker_user_id = $2 AND blocked_user_id = $1)
      LIMIT 1`,
    [a, b],
  );
  return (rowCount ?? 0) > 0;
}
