import { AppError } from '../../infra/errors.js';
import { pool } from '../../infra/db.js';

export interface Visitor {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  visitedAt: Date;
  /** Whether the profile owner already follows them. Drives the button state. */
  following: boolean;
}

/**
 * Follow someone.
 *
 * Idempotent: following twice is a no-op rather than an error. A double tap on
 * a slow connection is the common case, and a 409 there would be shown to a
 * user who did exactly the right thing.
 */
export async function followUser(followerId: string, followeeId: string): Promise<void> {
  if (followerId === followeeId) {
    throw new AppError('CANNOT_FOLLOW_SELF', 'You cannot follow yourself', 422);
  }

  // Checked explicitly so a bad id is a clean 404 rather than a foreign-key
  // violation mapped to a generic constraint error.
  const target = await pool.query('SELECT 1 FROM users WHERE id = $1', [followeeId]);
  if (target.rowCount === 0) {
    throw new AppError('USER_NOT_FOUND', 'That account does not exist', 404);
  }

  await pool.query(
    `INSERT INTO follows (follower_user_id, followee_user_id)
          VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [followerId, followeeId],
  );
}

/** Also idempotent. Unfollowing someone you never followed is not an error. */
export async function unfollowUser(followerId: string, followeeId: string): Promise<void> {
  await pool.query(
    'DELETE FROM follows WHERE follower_user_id = $1 AND followee_user_id = $2',
    [followerId, followeeId],
  );
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM follows WHERE follower_user_id = $1 AND followee_user_id = $2',
    [followerId, followeeId],
  );
  return rowCount! > 0;
}

/**
 * Records that someone looked at a profile.
 *
 * Upserted, not appended: the product question is "who has been looking",
 * not "how many times", and the append-only version grows without bound for a
 * popular host. Re-visiting refreshes the timestamp AND clears `seen_at`, so a
 * returning visitor surfaces again — which is the signal the owner cares about.
 */
export async function recordVisit(profileUserId: string, viewerId: string): Promise<void> {
  // Viewing your own profile is not a visit. Silent rather than an error: the
  // client cannot always know whose profile it is opening.
  if (profileUserId === viewerId) return;

  await pool.query(
    `INSERT INTO profile_visits (profile_user_id, viewer_user_id)
          VALUES ($1, $2)
     ON CONFLICT (profile_user_id, viewer_user_id)
     DO UPDATE SET visited_at = now(), seen_at = NULL`,
    [profileUserId, viewerId],
  );
}

export async function listVisitors(userId: string, limit: number): Promise<Visitor[]> {
  const { rows } = await pool.query<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    visited_at: Date;
    following: boolean;
  }>(
    `SELECT v.viewer_user_id AS user_id,
            p.display_name,
            p.avatar_url,
            v.visited_at,
            EXISTS (
              SELECT 1 FROM follows f
               WHERE f.follower_user_id = $1
                 AND f.followee_user_id = v.viewer_user_id
            ) AS following
       FROM profile_visits v
       JOIN user_profiles p ON p.user_id = v.viewer_user_id
      WHERE v.profile_user_id = $1
      ORDER BY v.visited_at DESC
      LIMIT $2`,
    [userId, limit],
  );

  return rows.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? 'Someone',
    avatarUrl: row.avatar_url,
    visitedAt: row.visited_at,
    following: row.following,
  }));
}

/** Clears the "N new" badge. Returns how many were cleared, for the client. */
export async function markVisitorsSeen(userId: string): Promise<number> {
  const { rowCount } = await pool.query(
    'UPDATE profile_visits SET seen_at = now() WHERE profile_user_id = $1 AND seen_at IS NULL',
    [userId],
  );
  return rowCount ?? 0;
}
