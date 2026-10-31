// Friends: a follow in both directions.
//
// Modelled, never stored — the same rule as the count on the profile summary
// — so the list can never disagree with the follows that exist.

import { pool } from '../../infra/db.js';
import { EMPTY_LOOK, looksFor, type UserLook } from '../cosmetics/index.js';

export interface Friend {
  userId: string;
  publicId: string;
  displayName: string | null;
  avatarUrl: string | null;
  userLevel: number;
  liveRoomId: string | null;
  look: UserLook;
  /** When the second follow landed — the moment you became friends. */
  since: string;
}

export async function listFriends(userId: string, limit = 100): Promise<Friend[]> {
  const { rows } = await pool.query<{
    id: string;
    public_id: string;
    display_name: string | null;
    avatar_url: string | null;
    user_level: number | null;
    live_room_id: string | null;
    since: Date;
  }>(
    `SELECT u.id, u.public_id, p.display_name, p.avatar_url, s.user_level,
            (SELECT r.id FROM rooms r WHERE r.host_user_id = u.id AND r.ended_at IS NULL LIMIT 1)
              AS live_room_id,
            GREATEST(mine.created_at, theirs.created_at) AS since
       FROM follows mine
       JOIN follows theirs
         ON theirs.follower_user_id = mine.followee_user_id
        AND theirs.followee_user_id = mine.follower_user_id
       JOIN users u ON u.id = mine.followee_user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE mine.follower_user_id = $1
        AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM blocks b
                         WHERE (b.blocker_user_id = $1 AND b.blocked_user_id = u.id)
                            OR (b.blocker_user_id = u.id AND b.blocked_user_id = $1))
      -- Who is live first, then the newest friendships.
      ORDER BY EXISTS (SELECT 1 FROM rooms r WHERE r.host_user_id = u.id AND r.ended_at IS NULL) DESC,
               GREATEST(mine.created_at, theirs.created_at) DESC
      LIMIT $2`,
    [userId, limit],
  );

  const looks = await looksFor(rows.map((r) => r.id));
  return rows.map((r) => ({
    userId: r.id,
    publicId: String(r.public_id),
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    userLevel: r.user_level ?? 1,
    liveRoomId: r.live_room_id,
    look: looks.get(r.id) ?? EMPTY_LOOK,
    since: r.since.toISOString(),
  }));
}
