// Going live, joining, and ending — the write side of a room.
//
// The division of labour with the media server, stated once:
//
//   · POSTGRES decides WHO MAY do something. Is this user banned from the room,
//     do they hold a seat, is the room still live.
//   · LIVEKIT enforces WHAT THEY CAN DO once connected, from a token this
//     module mints after making that decision.
//
// A client never asks for permission it can grant itself. `publish` comes from
// the seat table, never from the request body — that is the entire
// authorisation boundary of the media plane, and it is why `joinRoom` below
// takes no options.

import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import {
  announceRoomEnded,
  closeRoom,
  LISTENER_GRANTS,
  mintJoinToken,
  SPEAKER_GRANTS,
  type RtcJoinToken,
} from '../realtime/index.js';

export type RoomTag = 'singing' | 'dancing' | 'chatting' | 'gaming' | 'friends' | 'esports';

export interface LiveRoom {
  id: string;
  hostId: string;
  hostName: string | null;
  title: string;
  tag: string;
  country: string;
  coverUrl: string | null;
  video: boolean;
  seatCapacity: number | null;
  seatsTaken: number;
  viewers: number;
  startedAt: Date;
}

export interface RoomSeat {
  seatIndex: number;
  userId: string;
  displayName: string | null;
  muted: boolean;
  takenAt: Date;
}

interface RoomRow {
  id: string;
  host_user_id: string;
  host_name: string | null;
  title: string;
  tag: string;
  country: string;
  cover_url: string | null;
  is_video: boolean;
  seat_capacity: number | null;
  seats_taken: number;
  viewer_count: number;
  started_at: Date;
  ended_at: Date | null;
}

// `ended_at` is in the projection deliberately. It was left out once, and
// because the callers cast the result to a type that claimed the column was
// there, `row.ended_at` was `undefined` — which is not `null`, so the liveness
// check fired on every live room and nobody could join anything.
const ROOM_SELECT = `
  SELECT r.id, r.host_user_id, p.display_name AS host_name, r.title, r.tag, r.country,
         r.cover_url, r.is_video, r.seat_capacity, r.seats_taken, r.viewer_count,
         r.started_at, r.ended_at
    FROM rooms r
    LEFT JOIN user_profiles p ON p.user_id = r.host_user_id`;

function toLiveRoom(row: RoomRow): LiveRoom {
  return {
    id: row.id,
    hostId: row.host_user_id,
    hostName: row.host_name,
    title: row.title,
    tag: row.tag,
    country: row.country,
    coverUrl: row.cover_url,
    video: row.is_video,
    seatCapacity: row.seat_capacity,
    seatsTaken: row.seats_taken,
    viewers: row.viewer_count,
    startedAt: row.started_at,
  };
}

/**
 * Starts a broadcast.
 *
 * The room row is created FIRST and the token minted from it, because the room
 * id is what names the media room. Minting is local — a signature, no network
 * call — so going live cannot fail because the media server was briefly slow.
 *
 * The media room itself is not created here. LiveKit creates it when the first
 * participant connects, and pre-creating it would leave an empty room behind on
 * every host who changed their mind between tapping and connecting.
 */
export async function goLive(input: {
  hostId: string;
  title: string;
  tag: RoomTag;
  isVideo: boolean;
  /** Present for a party room, absent for a single-host broadcast. */
  seatCapacity?: number;
  coverUrl?: string;
  country?: string;
}): Promise<{ room: LiveRoom; rtc: RtcJoinToken }> {
  const roomId = uuidv7();

  const room = await withTransaction(async (client) => {
    // A host may have exactly one live room — enforced by a partial unique
    // index, checked here so a double-tap gets a sentence rather than a
    // constraint violation. The existing room is NOT ended and replaced: a
    // reconnect storm would then churn through rooms and scatter the audience.
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM rooms WHERE host_user_id = $1 AND ended_at IS NULL',
      [input.hostId],
    );
    if (existing.rows[0]) {
      throw new AppError('ALREADY_LIVE', 'You already have a live room', 409, {
        roomId: existing.rows[0].id,
      });
    }

    await client.query(
      `INSERT INTO rooms (id, host_user_id, title, tag, country, cover_url, is_video, seat_capacity)
            VALUES ($1, $2, $3, $4, COALESCE($5, 'IN'), $6, $7, $8)`,
      [
        roomId,
        input.hostId,
        input.title,
        input.tag,
        input.country ?? null,
        input.coverUrl ?? null,
        input.isVideo,
        input.seatCapacity ?? null,
      ],
    );

    // Seat 0 is the host's. Reserved at creation so nobody can take it, and so
    // the seat map renders the same way whoever is looking.
    if (input.seatCapacity !== undefined) {
      await client.query(
        'INSERT INTO room_seats (room_id, seat_index, user_id) VALUES ($1, 0, $2)',
        [roomId, input.hostId],
      );
      await client.query('UPDATE rooms SET seats_taken = 1 WHERE id = $1', [roomId]);
    }

    const { rows } = await client.query<RoomRow>(`${ROOM_SELECT} WHERE r.id = $1`, [roomId]);
    return toLiveRoom(rows[0]!);
  });

  logger.info('room started', { room_id: roomId, user_id: input.hostId });

  return {
    room,
    rtc: await mintJoinToken({
      roomId,
      userId: input.hostId,
      displayName: room.hostName ?? undefined,
      grants: SPEAKER_GRANTS,
    }),
  };
}

/**
 * A join credential for a viewer.
 *
 * Publish rights come from the SEAT TABLE and nowhere else. A user who already
 * holds a seat — because they reconnected after a dropped signal — gets it back
 * with speaking rights intact, which is what makes a tunnel a hiccup rather
 * than losing your place on stage.
 */
export async function joinRoom(input: {
  roomId: string;
  userId: string;
}): Promise<{ room: LiveRoom; seats: RoomSeat[]; rtc: RtcJoinToken; canPublish: boolean }> {
  const { rows } = await pool.query<RoomRow>(`${ROOM_SELECT} WHERE r.id = $1`, [input.roomId]);

  const row = rows[0];
  if (!row) throw new AppError('ROOM_NOT_FOUND', 'That room does not exist', 404);
  if (row.ended_at !== null) {
    throw new AppError('ROOM_ENDED', 'This room has ended', 410);
  }

  // Checked BEFORE a token is minted. Removing someone from the media server
  // only disconnects them — their SDK reconnects within seconds — so a kick
  // means nothing unless the join path is what refuses them.
  const banned = await pool.query('SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2', [
    input.roomId,
    input.userId,
  ]);
  if (banned.rowCount) {
    throw new AppError('ROOM_BANNED', 'You cannot join this room', 403);
  }

  const seat = await pool.query('SELECT 1 FROM room_seats WHERE room_id = $1 AND user_id = $2', [
    input.roomId,
    input.userId,
  ]);
  const canPublish = seat.rowCount! > 0;

  const profile = await pool.query<{ display_name: string | null }>(
    'SELECT display_name FROM user_profiles WHERE user_id = $1',
    [input.userId],
  );

  return {
    room: toLiveRoom(row),
    seats: await listSeats(input.roomId),
    canPublish,
    rtc: await mintJoinToken({
      roomId: input.roomId,
      userId: input.userId,
      displayName: profile.rows[0]?.display_name ?? undefined,
      grants: canPublish ? SPEAKER_GRANTS : LISTENER_GRANTS,
    }),
  };
}

/** The room and its seat map, without joining. What the room card expands into. */
export async function getRoom(roomId: string): Promise<{ room: LiveRoom; seats: RoomSeat[] }> {
  const { rows } = await pool.query<RoomRow>(`${ROOM_SELECT} WHERE r.id = $1`, [roomId]);
  const row = rows[0];
  if (!row) throw new AppError('ROOM_NOT_FOUND', 'That room does not exist', 404);

  return { room: toLiveRoom(row), seats: await listSeats(roomId) };
}

export async function listSeats(roomId: string): Promise<RoomSeat[]> {
  const { rows } = await pool.query<{
    seat_index: number;
    user_id: string;
    display_name: string | null;
    muted: boolean;
    taken_at: Date;
  }>(
    `SELECT s.seat_index, s.user_id, p.display_name, s.muted, s.taken_at
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
    takenAt: r.taken_at,
  }));
}

/**
 * The host ends their broadcast.
 *
 * Our row is closed FIRST, then the media room. That order matters: if the
 * media call fails, the room is already gone from the feed and nobody new can
 * join, and LiveKit's empty timeout will collect the orphan within minutes.
 * The other order would leave a room in the feed that nobody can actually
 * enter — a dead card the user taps repeatedly.
 */
export async function endRoom(input: { roomId: string; hostId: string }): Promise<void> {
  const ended = await withTransaction(async (client) => {
    const { rows } = await client.query<{ host_user_id: string; ended_at: Date | null }>(
      'SELECT host_user_id, ended_at FROM rooms WHERE id = $1 FOR UPDATE',
      [input.roomId],
    );

    const room = rows[0];
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'That room does not exist', 404);
    if (room.host_user_id !== input.hostId) {
      throw new AppError('NOT_ROOM_HOST', 'Only the host can end this room', 403);
    }
    // Already ended. Idempotent — a retry after a dropped response is ordinary.
    if (room.ended_at !== null) return false;

    await client.query(
      `UPDATE rooms
          SET ended_at = now(), ended_reason = 'host', viewer_count = 0, seats_taken = 0
        WHERE id = $1`,
      [input.roomId],
    );
    await client.query(
      'UPDATE room_sessions SET ended_at = now() WHERE room_id = $1 AND ended_at IS NULL',
      [input.roomId],
    );
    await client.query('DELETE FROM room_seats WHERE room_id = $1', [input.roomId]);
    return true;
  });

  if (!ended) return;

  logger.info('room ended', { room_id: input.roomId, user_id: input.hostId });

  // So viewers leave the screen rather than sitting in a room that no longer
  // exists, watching a seat map that will never change again.
  announceRoomEnded(input.roomId);

  // Best effort, deliberately. The room is already closed everywhere that
  // matters; failing the request now would tell the host their room is still
  // live when the feed already says otherwise.
  try {
    await closeRoom(input.roomId);
  } catch (err) {
    logger.warn('media room close failed after ending', { room_id: input.roomId, err });
  }
}
