import { pool } from "../../infra/db.js";
import { coldStartConfig } from "../config/index.js";
import { EMPTY_LOOK, looksFor, type UserLook } from "../cosmetics/index.js";

/** Someone on a party room's seats, as the card's avatar stack draws them. */
export interface SeatFace {
  userId: string;
  avatarUrl: string | null;
}

/** How many faces a card stacks before the count. */
const SEAT_FACES = 3;

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
  /** The host's user level, for the badge beside their name. */
  hostLevel: number;
  /** What the host is wearing — the name colour is the part a card shows. */
  hostLook: UserLook;
  title: string;
  tag: string;
  country: string;
  /**
   * Null while the cold-start rules hide counts. "3 watching" on every card is
   * what makes a new app look empty; a Live badge alone does not.
   */
  viewers: number | null;
  coverUrl: string | null;
  seatCount: number | null;
  seatCapacity: number | null;
  /**
   * The first few people seated, host's seat excluded, in seat order. Empty for
   * a live (non-party) room. A stack of real faces is what makes a room look
   * occupied; blank circles say the opposite.
   */
  seatFaces: SeatFace[];
  video: boolean;
  /** In the hourly top ten by viewers. Drives the flame badge. */
  trending: boolean;
}

export type FeedCategory = "explore" | "party" | "following";

/** How many rooms count as "trending" at any moment. */
const TRENDING_COUNT = 10;

interface Row {
  id: string;
  host_user_id: string;
  host_name: string | null;
  host_level: number | null;
  title: string;
  tag: string;
  country: string;
  viewer_count: number;
  cover_url: string | null;
  seats_taken: number;
  seat_capacity: number | null;
  is_video: boolean;
  rank: string;
  seat_faces: { user_id: string; avatar_url: string | null }[] | null;
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
  const coldStart = await coldStartConfig();

  // Consolidation: show a few full rooms rather than many thin ones, so each
  // one a user opens has people in it. Following is exempt — someone who chose
  // to follow a host should always find their room.
  let limit = input.limit;
  if (coldStart.maxFeedRooms !== null && input.category !== "following") {
    limit = Math.min(limit, Math.max(0, coldStart.maxFeedRooms - input.offset));
    if (limit === 0) return [];
  }

  const rows = await queryRooms({ ...input, limit });
  const looks = await looksFor(rows.map((row) => row.host_user_id));
  return rows.map((row) => toFeedRoom(row, coldStart.hideViewerCounts, looks));
}

/**
 * The fullest live room — where a brand-new user is dropped on their first
 * open (growth-plan-v1: "naye user ko turant sabse bhare room mein daalo").
 *
 * Never a room the viewer hosts, never one across a block. Null when nothing
 * is live, or when the dial is off.
 */
export async function fullestRoom(
  viewerId: string | undefined,
): Promise<FeedRoom | null> {
  const coldStart = await coldStartConfig();
  if (!coldStart.dropNewUsersIntoRoom) return null;

  const rows = await queryRooms({
    category: "any",
    viewerId,
    limit: 1,
    offset: 0,
  });
  if (!rows[0]) return null;
  const looks = await looksFor([rows[0].host_user_id]);
  return toFeedRoom(rows[0], coldStart.hideViewerCounts, looks);
}

async function queryRooms(input: {
  category: FeedCategory | "any";
  viewerId?: string;
  limit: number;
  offset: number;
}): Promise<Row[]> {
  const filters: string[] = ["r.ended_at IS NULL"];
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

  if (input.category === "any") {
    // Not a room of your own, which you cannot be "dropped into".
    if (input.viewerId) filters.push(`r.host_user_id <> $1::uuid`);
  } else if (input.category === "party") {
    filters.push("r.seat_capacity IS NOT NULL");
  } else if (input.category === "explore") {
    filters.push("r.seat_capacity IS NULL");
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
            s.user_level AS host_level,
            r.title,
            r.tag,
            r.country,
            r.viewer_count,
            r.cover_url,
            r.seats_taken,
            r.seat_capacity,
            r.is_video,
            -- At most three rows per room off the primary key, so this stays a
            -- handful of index lookups however many cards the page holds.
            CASE WHEN r.seat_capacity IS NULL THEN NULL ELSE (
              SELECT json_agg(json_build_object('user_id', f.user_id, 'avatar_url', f.avatar_url)
                              ORDER BY f.seat_index)
                FROM (SELECT rs.seat_index, rs.user_id, sp.avatar_url
                        FROM room_seats rs
                        LEFT JOIN user_profiles sp ON sp.user_id = rs.user_id
                       WHERE rs.room_id = r.id AND rs.seat_index > 0
                       ORDER BY rs.seat_index
                       LIMIT ${SEAT_FACES}) f
            ) END AS seat_faces,
            rank() OVER (ORDER BY r.viewer_count DESC, r.started_at DESC) AS rank
       FROM rooms r
       JOIN user_profiles p ON p.user_id = r.host_user_id
       LEFT JOIN user_stats s ON s.user_id = r.host_user_id
      WHERE ${filters.join(" AND ")}
      ORDER BY r.viewer_count DESC, r.started_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

function toFeedRoom(
  row: Row,
  hideViewerCounts: boolean,
  looks: Map<string, UserLook>,
): FeedRoom {
  return {
    id: row.id,
    hostId: row.host_user_id,
    // A host with no display name yet is still a real room. Falling back keeps
    // the card renderable rather than showing an empty line.
    hostName: row.host_name ?? "Host",
    hostLevel: row.host_level ?? 1,
    hostLook: looks.get(row.host_user_id) ?? EMPTY_LOOK,
    title: row.title,
    tag: row.tag,
    country: row.country,
    viewers: hideViewerCounts ? null : row.viewer_count,
    coverUrl: row.cover_url,
    seatCount: row.seat_capacity === null ? null : row.seats_taken,
    seatCapacity: row.seat_capacity,
    seatFaces: (row.seat_faces ?? []).map((face) => ({
      userId: face.user_id,
      avatarUrl: face.avatar_url,
    })),
    video: row.is_video,
    trending: Number(row.rank) <= TRENDING_COUNT,
  };
}
