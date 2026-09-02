import { pool } from '../../infra/db.js';

/**
 * A room as the feed shows it.
 *
 * Shaped for the card, not for the table: `hostName` is joined in and
 * `seatCapacity` being non-null is what tells a party room from a live one.
 * The client should never have to run a second query to draw a list item.
 */
export interface FeedRoom {
  id: string;
  hostId: string;
  hostName: string;
  title: string;
  tag: string;
  country: string;
  viewers: number;
  coverUrl: string | null;
  seatCount: number | null;
  seatCapacity: number | null;
  video: boolean;
  /** In the hourly top ten by viewers. Drives the flame badge. */
  trending: boolean;
}

export type FeedCategory = 'explore' | 'party' | 'following';

/** How many rooms count as "trending" at any moment. */
const TRENDING_COUNT = 10;

interface Row {
  id: string;
  host_user_id: string;
  host_name: string | null;
  title: string;
  tag: string;
  country: string;
  viewer_count: number;
  cover_url: string | null;
  seats_taken: number;
  seat_capacity: number | null;
  is_video: boolean;
  rank: string;
}

/**
 * The feed.
 *
 * One query, no N+1: the host's display name is joined rather than fetched per
 * card, and `trending` is computed in the same pass with a window function
 * instead of a second "top ten" round trip that could disagree with this one.
 *
 * Ended rooms are excluded by the partial index, so this never scans history.
 */
export async function listFeed(input: {
  category: FeedCategory;
  viewerId?: string;
  limit: number;
  offset: number;
}): Promise<FeedRoom[]> {
  const filters: string[] = ['r.ended_at IS NULL'];
  const params: unknown[] = [];

  // A block that does not hide the room is theatre. Applied in BOTH directions:
  // if A blocked B, neither should see the other's room in a feed.
  if (input.viewerId) {
    params.push(input.viewerId);
    filters.push(
      `NOT EXISTS (SELECT 1 FROM blocks b
                    WHERE (b.blocker_user_id = $${params.length}::uuid AND b.blocked_user_id = r.host_user_id)
                       OR (b.blocked_user_id = $${params.length}::uuid AND b.blocker_user_id = r.host_user_id))`,
    );
  }

  if (input.category === 'party') {
    filters.push('r.seat_capacity IS NOT NULL');
  } else if (input.category === 'explore') {
    filters.push('r.seat_capacity IS NULL');
  } else {
    // Following. A guest follows nobody, and rather than returning everyone's
    // rooms we return none — the empty state says what to do next, which is
    // more useful than a feed that silently ignores the filter.
    params.push(input.viewerId ?? null);
    filters.push(
      `EXISTS (SELECT 1 FROM follows f
                WHERE f.follower_user_id = $${params.length}::uuid
                  AND f.followee_user_id = r.host_user_id)`,
    );
  }

  params.push(input.limit, input.offset);

  const { rows } = await pool.query<Row>(
    `SELECT r.id,
            r.host_user_id,
            p.display_name AS host_name,
            r.title,
            r.tag,
            r.country,
            r.viewer_count,
            r.cover_url,
            r.seats_taken,
            r.seat_capacity,
            r.is_video,
            rank() OVER (ORDER BY r.viewer_count DESC, r.started_at DESC) AS rank
       FROM rooms r
       JOIN user_profiles p ON p.user_id = r.host_user_id
      WHERE ${filters.join(' AND ')}
      ORDER BY r.viewer_count DESC, r.started_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    hostId: row.host_user_id,
    // A host with no display name yet is still a real room. Falling back keeps
    // the card renderable rather than showing an empty line.
    hostName: row.host_name ?? 'Host',
    title: row.title,
    tag: row.tag,
    country: row.country,
    viewers: row.viewer_count,
    coverUrl: row.cover_url,
    seatCount: row.seat_capacity === null ? null : row.seats_taken,
    seatCapacity: row.seat_capacity,
    video: row.is_video,
    trending: Number(row.rank) <= TRENDING_COUNT,
  }));
}
