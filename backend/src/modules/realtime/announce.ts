// Telling the gateway what the API just changed.
//
// A seat changes over HTTP — taken, left, removed, kicked — and the people
// looking at that room are holding sockets on a DIFFERENT process. This is the
// only way the API reaches them.
//
// Fire and forget, always. The seat is already taken and committed by the time
// anything here runs; an announcement that fails costs a client one extra poll
// and must never fail the request that the user actually completed.
//
// The message shapes mirror the gateway's `ServerMessage` union. They are not
// imported from it on purpose: the API process has no business loading the
// gateway's protocol, and the two are held together by the tests rather than
// by a type that would drag one process into the other.

import { pool } from '../../infra/db.js';
import { publishToRoom } from '../../infra/roomBus.js';

/** The seat map, to everyone in the room. Replaces the client's polling. */
export async function announceSeats(roomId: string): Promise<void> {
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

  publishToRoom(roomId, {
    t: 'seats',
    roomId,
    seats: rows.map((r) => ({
      seatIndex: r.seat_index,
      userId: r.user_id,
      displayName: r.display_name,
      muted: r.muted,
    })),
  });
}

/**
 * The room is over.
 *
 * Sent so viewers leave the screen rather than sitting in a room that no
 * longer exists, watching a seat map that will never change again.
 */
export function announceRoomEnded(roomId: string): void {
  publishToRoom(roomId, { t: 'room:ended', roomId });
}
