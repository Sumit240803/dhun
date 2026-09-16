// Search: people, and rooms that are live right now.
//
// What someone types is either a NAME or an ID. Everyone on the app has a
// public numeric ID, and hosts read theirs out on stream and print it on
// posters — "search 10004417" — so an all-digits query is matched exactly
// against it first. Names are matched by prefix, case-insensitively, which is
// what the index in migration 017 can serve; a contains-match would scan every
// profile on every keystroke.
//
// Blocks hide in both directions, as they do in the feed.

import { pool } from '../../infra/db.js';
import { coldStartConfig } from '../config/index.js';
import { EMPTY_LOOK, looksFor, type UserLook } from '../cosmetics/index.js';

export interface PersonResult {
  userId: string;
  publicId: string;
  displayName: string;
  avatarUrl: string | null;
  userLevel: number;
  /** Their live room, if broadcasting now — the result opens straight into it. */
  liveRoomId: string | null;
  isFollowing: boolean;
  look: UserLook;
}

export interface RoomResult {
  id: string;
  title: string;
  hostId: string;
  hostName: string;
  viewers: number | null;
  party: boolean;
}

const LIMIT = 20;

/** LIKE's wildcards, escaped, so "50%" searches for "50%" rather than "50" + anything. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function search(
  rawQuery: string,
  viewerId: string | undefined,
): Promise<{ people: PersonResult[]; rooms: RoomResult[] }> {
  const query = rawQuery.trim().replace(/\s+/g, ' ');
  if (query.length === 0) return { people: [], rooms: [] };

  const prefix = `${escapeLike(query.toLowerCase())}%`;
  const exactId = /^\d{5,18}$/.test(query) ? query : null;
  const viewer = viewerId ?? null;

  const [people, rooms, coldStart] = await Promise.all([
    pool.query<{
      id: string;
      public_id: string;
      display_name: string;
      avatar_url: string | null;
      user_level: number | null;
      live_room_id: string | null;
      is_following: boolean;
    }>(
      `SELECT u.id, u.public_id, p.display_name, p.avatar_url, s.user_level,
              (SELECT r.id FROM rooms r
                WHERE r.host_user_id = u.id AND r.ended_at IS NULL LIMIT 1) AS live_room_id,
              EXISTS (SELECT 1 FROM follows f
                       WHERE f.follower_user_id = $3::uuid AND f.followee_user_id = u.id) AS is_following
         FROM users u
         JOIN user_profiles p ON p.user_id = u.id
         LEFT JOIN user_stats s ON s.user_id = u.id
        WHERE u.status = 'active'
          AND p.display_name IS NOT NULL
          AND (u.public_id = $1::bigint OR lower(p.display_name) LIKE $2)
          AND ($3::uuid IS NULL OR u.id <> $3::uuid)
          AND NOT EXISTS (SELECT 1 FROM blocks b
                           WHERE (b.blocker_user_id = $3::uuid AND b.blocked_user_id = u.id)
                              OR (b.blocker_user_id = u.id AND b.blocked_user_id = $3::uuid))
        -- The exact ID first, then whoever is live, then alphabetical.
        ORDER BY (u.public_id = $1::bigint) DESC NULLS LAST,
                 (SELECT 1 FROM rooms r WHERE r.host_user_id = u.id AND r.ended_at IS NULL LIMIT 1) NULLS LAST,
                 lower(p.display_name)
        LIMIT $4`,
      [exactId, prefix, viewer, LIMIT],
    ),
    pool.query<{
      id: string;
      title: string;
      host_user_id: string;
      host_name: string | null;
      viewer_count: number;
      seat_capacity: number | null;
    }>(
      `SELECT r.id, r.title, r.host_user_id, p.display_name AS host_name, r.viewer_count, r.seat_capacity
         FROM rooms r
         LEFT JOIN user_profiles p ON p.user_id = r.host_user_id
        WHERE r.ended_at IS NULL
          -- Live rooms are few at any moment, so a contains-match on the title
          -- is cheap here where it would not be across every profile.
          AND (lower(r.title) LIKE '%' || $1 OR lower(p.display_name) LIKE $1)
          AND NOT EXISTS (SELECT 1 FROM blocks b
                           WHERE (b.blocker_user_id = $2::uuid AND b.blocked_user_id = r.host_user_id)
                              OR (b.blocker_user_id = r.host_user_id AND b.blocked_user_id = $2::uuid))
        ORDER BY r.viewer_count DESC, r.started_at DESC
        LIMIT $3`,
      [prefix, viewer, LIMIT],
    ),
    coldStartConfig(),
  ]);

  const looks = await looksFor(people.rows.map((row) => row.id));

  return {
    people: people.rows.map((row) => ({
      userId: row.id,
      publicId: String(row.public_id),
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      userLevel: row.user_level ?? 1,
      liveRoomId: row.live_room_id,
      isFollowing: row.is_following,
      look: looks.get(row.id) ?? EMPTY_LOOK,
    })),
    rooms: rooms.rows.map((row) => ({
      id: row.id,
      title: row.title,
      hostId: row.host_user_id,
      hostName: row.host_name ?? 'Host',
      viewers: coldStart.hideViewerCounts ? null : row.viewer_count,
      party: row.seat_capacity !== null,
    })),
  };
}
