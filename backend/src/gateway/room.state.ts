// The database work behind each gateway message.
//
// Deliberately separate from the socket handling: everything here is ordinary
// async functions over Postgres that can be tested without opening a socket,
// and the connection layer stays about connections.
//
// Nothing here decides authorisation on its own — the caller has already
// established who the user is from a verified token, and the queries below
// enforce the rest (is the room live, is this person the host, do they hold a
// seat) in the same statement that does the work rather than in a check
// beforehand that could go stale between the two.

import { uuidv7 } from 'uuidv7';
import { pool } from '../infra/db.js';
import { AppError } from '../infra/errors.js';
import type { ChatLine, MicRequest, SeatView } from './protocol.js';

/** How much backlog a late arrival gets. Enough to look busy, not a transcript. */
const HISTORY_SIZE = 40;

export interface RoomSnapshot {
  hostUserId: string;
  seats: SeatView[];
  history: ChatLine[];
}

/**
 * Everything a client needs on joining, in as few round trips as possible.
 *
 * Throws if the room is not live — a socket must not be able to join a room
 * the REST API would refuse, and a client holding a stale room id from the
 * feed is the ordinary case, not an attack.
 */
export async function snapshot(roomId: string): Promise<RoomSnapshot> {
  const { rows } = await pool.query<{ host_user_id: string; ended_at: Date | null }>(
    'SELECT host_user_id, ended_at FROM rooms WHERE id = $1',
    [roomId],
  );

  const room = rows[0];
  if (!room) throw new AppError('ROOM_NOT_FOUND', 'That room does not exist', 404);
  if (room.ended_at !== null) throw new AppError('ROOM_ENDED', 'This room has ended', 410);

  const [seats, history] = await Promise.all([listSeats(roomId), recentMessages(roomId)]);
  return { hostUserId: room.host_user_id, seats, history };
}

export async function listSeats(roomId: string): Promise<SeatView[]> {
  const { rows } = await pool.query<{
    seat_index: number;
    user_id: string;
    display_name: string | null;
    muted: boolean;
  }>(
    `SELECT s.seat_index, s.user_id, p.display_name, s.muted
       FROM room_seats s
       LEFT JOIN user_profiles p ON p.user_id = s.user_id
      WHERE s.room_id = $1
      ORDER BY s.seat_index`,
    [roomId],
  );

  return rows.map((r) => ({
    seatIndex: r.seat_index,
    userId: r.user_id,
    displayName: r.display_name,
    muted: r.muted,
  }));
}

/**
 * The backlog, oldest-first for rendering.
 *
 * Fetched newest-first so the index is scanned backwards and the LIMIT stops
 * early, then reversed in memory — 40 items, which is cheaper than asking
 * Postgres to sort the whole room's history the other way.
 *
 * Blocked messages are excluded. They exist for moderation, and were never
 * delivered to anyone the first time.
 */
export async function recentMessages(roomId: string): Promise<ChatLine[]> {
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    display_name: string | null;
    body: string;
    created_at: Date;
  }>(
    `SELECT m.id, m.user_id, p.display_name, m.body, m.created_at
       FROM room_messages m
       LEFT JOIN user_profiles p ON p.user_id = m.user_id
      WHERE m.room_id = $1 AND m.verdict <> 'blocked'
      ORDER BY m.created_at DESC
      LIMIT $2`,
    [roomId, HISTORY_SIZE],
  );

  return rows
    .map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.display_name,
      body: r.body,
      at: r.created_at.toISOString(),
    }))
    .reverse();
}

/**
 * Records a chat message.
 *
 * Written BEFORE it is broadcast. A message everyone saw but nothing recorded
 * is exactly the one a report will be filed about, and "we do not have it" is
 * not an answer a grievance officer can give.
 *
 * The verdict comes from the caller's filter, and the ORIGINAL text is stored
 * whatever it says — a moderator reviewing an appeal needs what was actually
 * typed, not the cleaned version.
 */
export async function recordMessage(input: {
  roomId: string;
  userId: string;
  body: string;
  verdict: 'clean' | 'filtered' | 'blocked';
}): Promise<ChatLine> {
  const id = uuidv7();

  const { rows } = await pool.query<{ created_at: Date; display_name: string | null }>(
    `INSERT INTO room_messages (id, room_id, user_id, body, verdict)
          VALUES ($1, $2, $3, $4, $5)
       RETURNING created_at,
                 (SELECT display_name FROM user_profiles WHERE user_id = $3) AS display_name`,
    [id, input.roomId, input.userId, input.body, input.verdict],
  );

  return {
    id,
    userId: input.userId,
    name: rows[0].display_name,
    body: input.body,
    at: rows[0].created_at.toISOString(),
  };
}

/** Barred from the room, so barred from talking in it. */
export async function isBanned(roomId: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
  return rowCount! > 0;
}

/**
 * Raises a hand.
 *
 * `ON CONFLICT` resets an earlier request rather than refusing: someone denied
 * five minutes ago asking again is normal, and making them wait for a row to
 * expire would be a rule nobody could see.
 */
export async function requestMic(roomId: string, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO room_mic_requests (room_id, user_id) VALUES ($1, $2)
     ON CONFLICT (room_id, user_id)
     DO UPDATE SET status = 'pending', requested_at = now(), resolved_at = NULL`,
    [roomId, userId],
  );
}

export async function cancelMic(roomId: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE room_mic_requests SET status = 'cancelled', resolved_at = now()
      WHERE room_id = $1 AND user_id = $2 AND status = 'pending'`,
    [roomId, userId],
  );
}

/** Marks a request answered. The seat itself is granted by the rooms module. */
export async function resolveMic(
  roomId: string,
  userId: string,
  approved: boolean,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE room_mic_requests SET status = $3, resolved_at = now()
      WHERE room_id = $1 AND user_id = $2 AND status = 'pending'`,
    [roomId, userId, approved ? 'granted' : 'denied'],
  );
  return rowCount! > 0;
}

/** The host's queue: still waiting, oldest first. */
export async function pendingMicRequests(roomId: string): Promise<MicRequest[]> {
  const { rows } = await pool.query<{
    user_id: string;
    display_name: string | null;
    requested_at: Date;
  }>(
    `SELECT r.user_id, p.display_name, r.requested_at
       FROM room_mic_requests r
       LEFT JOIN user_profiles p ON p.user_id = r.user_id
      WHERE r.room_id = $1 AND r.status = 'pending'
      ORDER BY r.requested_at`,
    [roomId],
  );

  return rows.map((r) => ({
    userId: r.user_id,
    name: r.display_name,
    requestedAt: r.requested_at.toISOString(),
  }));
}

/**
 * The lowest free seat, or null when the room is full.
 *
 * Seat 0 is skipped — it belongs to the host from the moment the room is
 * created and is never in the pool.
 */
export async function firstFreeSeat(roomId: string): Promise<number | null> {
  const { rows } = await pool.query<{ seat_capacity: number | null; taken: number[] }>(
    `SELECT r.seat_capacity,
            COALESCE(array_agg(s.seat_index) FILTER (WHERE s.seat_index IS NOT NULL), '{}') AS taken
       FROM rooms r
       LEFT JOIN room_seats s ON s.room_id = r.id
      WHERE r.id = $1
      GROUP BY r.seat_capacity`,
    [roomId],
  );

  const room = rows[0];
  if (!room?.seat_capacity) return null;

  const taken = new Set(room.taken);
  for (let index = 1; index < room.seat_capacity; index++) {
    if (!taken.has(index)) return index;
  }
  return null;
}
