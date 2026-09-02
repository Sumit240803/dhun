import { AppError } from '../../infra/errors.js';
import { pool } from '../../infra/db.js';
import { isBlockedBetween } from '../moderation/index.js';

/**
 * What a STRANGER may see.
 *
 * Deliberately narrower than the owner's own summary: no points balance, no
 * unseen-visitor count, no date of birth, no phone. Deciding what a stranger
 * sees is a trust-and-safety question, so the safe default is that a field is
 * absent until someone decides it should be there.
 */
export interface PublicProfile {
  userId: string;
  publicId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  country: string;
  userLevel: number;
  followers: number;
  following: number;
  /** Whether the VIEWER follows them. Lets the button render without a second call. */
  isFollowing: boolean;
  /** Their live room, if they are broadcasting right now. */
  liveRoomId: string | null;
}

export async function getPublicProfile(
  viewerId: string,
  targetId: string,
): Promise<PublicProfile> {
  // Checked FIRST, before anything is read. A blocked person must not be able
  // to learn a display name, a follower count, or whether someone is live —
  // and returning 404 rather than 403 means they cannot even confirm the
  // account exists.
  if (await isBlockedBetween(viewerId, targetId)) {
    throw new AppError('USER_NOT_FOUND', 'That account does not exist', 404);
  }

  const { rows } = await pool.query<{
    public_id: string;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    country: string;
    user_level: number | null;
    followers: string;
    following: string;
    is_following: boolean;
    live_room_id: string | null;
  }>(
    `SELECT u.public_id,
            p.display_name,
            p.avatar_url,
            p.bio,
            p.country,
            s.user_level,
            (SELECT count(*) FROM follows f WHERE f.followee_user_id = u.id) AS followers,
            (SELECT count(*) FROM follows f WHERE f.follower_user_id = u.id) AS following,
            EXISTS (
              SELECT 1 FROM follows f
               WHERE f.follower_user_id = $2 AND f.followee_user_id = u.id
            ) AS is_following,
            (SELECT r.id FROM rooms r
              WHERE r.host_user_id = u.id AND r.ended_at IS NULL
              LIMIT 1) AS live_room_id
       FROM users u
       JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE u.id = $1
        -- A banned account is gone as far as everyone else is concerned.
        AND u.status <> 'banned'`,
    [targetId, viewerId],
  );

  const row = rows[0];
  if (!row) throw new AppError('USER_NOT_FOUND', 'That account does not exist', 404);

  return {
    userId: targetId,
    publicId: String(row.public_id),
    displayName: row.display_name ?? 'Someone',
    avatarUrl: row.avatar_url,
    bio: row.bio,
    country: row.country,
    userLevel: row.user_level ?? 1,
    followers: Number(row.followers),
    following: Number(row.following),
    isFollowing: row.is_following,
    liveRoomId: row.live_room_id,
  };
}
