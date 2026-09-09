// Mic seats, and the host's control over them.
//
// ── The two-system problem, and how it is resolved ───────────────────────────
//
// Taking a seat has to change two things that cannot change atomically: a row
// in Postgres, and a permission on the media server. There is no transaction
// spanning both, so one of them is wrong for a moment and the question is
// which failure is survivable.
//
// The order used here is DATABASE FIRST, then the media server, and the
// database write is COMPENSATED if the media call fails.
//
//   · Database first, because the seat row is what settles the race between
//     everyone who tapped at once. Calling the media server first would let two
//     people both be granted publish before either row was written.
//
//   · Compensated, because the alternative — leaving the row in place — is a
//     user who visibly holds seat 3 and cannot talk, with no way to fix it
//     except leaving the room. Releasing the seat and reporting the failure
//     gives them a button to press again.
//
// The transaction is committed BEFORE the network call rather than held open
// across it. Holding a row lock during an HTTP request to another machine is
// how a slow media server turns into a database pile-up.

import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import {
  announceSeats,
  LISTENER_GRANTS,
  muteParticipant,
  removeParticipant,
  setGrants,
  SPEAKER_GRANTS,
} from '../realtime/index.js';

interface RoomState {
  host_user_id: string;
  seat_capacity: number | null;
  ended_at: Date | null;
}

async function loadLiveRoom(roomId: string): Promise<RoomState> {
  const { rows } = await pool.query<RoomState>(
    'SELECT host_user_id, seat_capacity, ended_at FROM rooms WHERE id = $1',
    [roomId],
  );
  const room = rows[0];
  if (!room) throw new AppError('ROOM_NOT_FOUND', 'That room does not exist', 404);
  if (room.ended_at !== null) throw new AppError('ROOM_ENDED', 'This room has ended', 410);
  return room;
}

/** The host, or nobody. Every moderation action in this file goes through it. */
function assertHost(room: RoomState, userId: string): void {
  if (room.host_user_id !== userId) {
    throw new AppError('NOT_ROOM_HOST', 'Only the host can do that', 403);
  }
}

/**
 * Takes a mic seat.
 *
 * The primary key on (room_id, seat_index) is what decides a contested seat —
 * not a read-then-write, which would let two people both see it free. The
 * loser gets SEAT_TAKEN, which is a true and useful thing to tell them.
 */
export async function takeSeat(input: {
  roomId: string;
  userId: string;
  seatIndex: number;
}): Promise<void> {
  const room = await loadLiveRoom(input.roomId);

  if (room.seat_capacity === null) {
    throw new AppError('NOT_A_PARTY_ROOM', 'This room has no seats', 409);
  }
  if (input.seatIndex >= room.seat_capacity) {
    throw new AppError('SEAT_OUT_OF_RANGE', 'That seat does not exist in this room', 422);
  }
  // Seat 0 belongs to the host from the moment the room is created. Saying so
  // is clearer than the SEAT_TAKEN the constraint would otherwise produce.
  if (input.seatIndex === 0 && room.host_user_id !== input.userId) {
    throw new AppError('SEAT_RESERVED', "That is the host's seat", 403);
  }

  const banned = await pool.query('SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2', [
    input.roomId,
    input.userId,
  ]);
  if (banned.rowCount) throw new AppError('ROOM_BANNED', 'You cannot join this room', 403);

  await withTransaction(async (client) => {
    const held = await client.query<{ seat_index: number }>(
      'SELECT seat_index FROM room_seats WHERE room_id = $1 AND user_id = $2',
      [input.roomId, input.userId],
    );
    if (held.rows[0]) {
      // Already speaking. Re-taking the same seat is a no-op rather than an
      // error, because a retried request must not read as a failure.
      if (held.rows[0].seat_index === input.seatIndex) return;
      throw new AppError('ALREADY_SEATED', 'You are already on a seat', 409);
    }

    try {
      await client.query(
        'INSERT INTO room_seats (room_id, seat_index, user_id) VALUES ($1, $2, $3)',
        [input.roomId, input.seatIndex, input.userId],
      );
    } catch (err) {
      // 23505 = unique_violation. Somebody else got there first, in the
      // milliseconds since the capacity check above.
      if ((err as { code?: string }).code === '23505') {
        throw new AppError('SEAT_TAKEN', 'Somebody just took that seat', 409);
      }
      throw err;
    }

    await client.query('UPDATE rooms SET seats_taken = seats_taken + 1 WHERE id = $1', [
      input.roomId,
    ]);
  });

  // The compensating action. See the note at the top of this file.
  try {
    await setGrants({ roomId: input.roomId, userId: input.userId, grants: SPEAKER_GRANTS });
  } catch (err) {
    await releaseSeatRow(input.roomId, input.userId);
    logger.warn('seat rolled back after media grant failed', {
      room_id: input.roomId,
      user_id: input.userId,
      err,
    });
    // Re-raised as a clean 503 rather than rethrown as-is. The provider is
    // expected to map its own failures, but this module must not depend on
    // that: an unmapped error here becomes a 500 with a stack trace on a
    // screen where somebody tapped a microphone.
    throw err instanceof AppError
      ? err
      : new AppError('RTC_UNAVAILABLE', 'Could not put you on the mic. Try again.', 503);
  }

  logger.info('seat taken', {
    room_id: input.roomId,
    user_id: input.userId,
    seat: input.seatIndex,
  });

  // Pushed to everyone looking at the room. Without this the seat map is only
  // as fresh as the client's next poll, and the person who just took the mic
  // appears to the room several seconds after they start talking.
  await announceSeats(input.roomId);
}

/**
 * Leaves a seat, or is removed from one by the host.
 *
 * The database row goes first and the permission is revoked after. If the media
 * call fails the user keeps talking for a few seconds until the token expires —
 * unfortunate, but strictly better than the alternative, where the seat is
 * visibly free and the person on it is still audible with no row to explain it.
 *
 * Revoking publish also unpublishes whatever they were sending, so they go
 * quiet rather than merely being unable to start again.
 */
export async function releaseSeat(input: {
  roomId: string;
  userId: string;
  /** The caller, when a host is removing somebody else. */
  actorId: string;
}): Promise<void> {
  const room = await loadLiveRoom(input.roomId);

  if (input.actorId !== input.userId) assertHost(room, input.actorId);

  // The host's own seat is not releasable — it exists for as long as the room
  // does. Ending the broadcast is the action they actually want.
  if (input.userId === room.host_user_id) {
    throw new AppError('HOST_SEAT_FIXED', 'End the room instead', 409);
  }

  const released = await releaseSeatRow(input.roomId, input.userId);
  if (!released) throw new AppError('NOT_SEATED', 'That user is not on a seat', 409);

  // Best effort, like the kick path. The seat is already free and the seat map
  // already says so; failing here would tell the caller the action did not work
  // when the only part still outstanding is a permission that expires with the
  // token in at most a few minutes anyway.
  try {
    await setGrants({ roomId: input.roomId, userId: input.userId, grants: LISTENER_GRANTS });
  } catch (err) {
    logger.warn('media grant revoke failed after releasing seat', {
      room_id: input.roomId,
      user_id: input.userId,
      err,
    });
  }

  logger.info('seat released', {
    room_id: input.roomId,
    user_id: input.userId,
    actor_id: input.actorId,
  });

  await announceSeats(input.roomId);
}

/** The row half of releasing, shared with the rollback path above. */
async function releaseSeatRow(roomId: string, userId: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM room_seats WHERE room_id = $1 AND user_id = $2',
      [roomId, userId],
    );
    if (!rowCount) return false;

    await client.query(
      'UPDATE rooms SET seats_taken = GREATEST(0, seats_taken - 1) WHERE id = $1',
      [roomId],
    );
    return true;
  });
}

/**
 * The host silences a seat without taking it.
 *
 * Persisted, because it has to survive the user reconnecting. A mute that lived
 * only on the media server would be undone by the muted person force-quitting
 * the app — which is exactly what somebody being muted for a reason will do.
 */
export async function setSeatMuted(input: {
  roomId: string;
  userId: string;
  hostId: string;
  muted: boolean;
}): Promise<void> {
  const room = await loadLiveRoom(input.roomId);
  assertHost(room, input.hostId);

  const { rowCount } = await pool.query(
    'UPDATE room_seats SET muted = $3 WHERE room_id = $1 AND user_id = $2',
    [input.roomId, input.userId, input.muted],
  );
  if (!rowCount) throw new AppError('NOT_SEATED', 'That user is not on a seat', 409);

  // NOT best effort, unlike releasing a seat. A mute that never reached the
  // media server has changed nothing anyone can hear, and telling the host it
  // worked would leave them believing a disruptive speaker is silenced.
  try {
    await muteParticipant({ roomId: input.roomId, userId: input.userId, muted: input.muted });
  } catch (err) {
    await pool.query('UPDATE room_seats SET muted = NOT $3 WHERE room_id = $1 AND user_id = $2', [
      input.roomId,
      input.userId,
      input.muted,
    ]);
    throw err instanceof AppError
      ? err
      : new AppError('RTC_UNAVAILABLE', 'Could not change that. Try again.', 503);
  }

  logger.info('seat mute changed', {
    room_id: input.roomId,
    user_id: input.userId,
    muted: input.muted,
  });

  await announceSeats(input.roomId);
}

/**
 * The host throws somebody out.
 *
 * The BAN ROW is what does the work. Disconnecting them from the media server
 * is cosmetic on its own — the SDK reconnects in seconds — so the row is
 * written first and the disconnect is best effort afterwards.
 *
 * Room-scoped, and deliberately not a platform ban. A host clearing their own
 * room is not a judgement about the account, and letting it become one would
 * hand every host the power to suspend a user.
 */
export async function kickFromRoom(input: {
  roomId: string;
  userId: string;
  hostId: string;
  reason?: string;
}): Promise<void> {
  const room = await loadLiveRoom(input.roomId);
  assertHost(room, input.hostId);

  if (input.userId === room.host_user_id) {
    throw new AppError('CANNOT_KICK_HOST', 'The host cannot be removed', 409);
  }

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO room_bans (room_id, user_id, banned_by, reason) VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [input.roomId, input.userId, input.hostId, input.reason ?? null],
    );

    const { rowCount } = await client.query(
      'DELETE FROM room_seats WHERE room_id = $1 AND user_id = $2',
      [input.roomId, input.userId],
    );
    if (rowCount) {
      await client.query(
        'UPDATE rooms SET seats_taken = GREATEST(0, seats_taken - 1) WHERE id = $1',
        [input.roomId],
      );
    }
  });

  logger.warn('user kicked from room', {
    room_id: input.roomId,
    user_id: input.userId,
    actor_id: input.hostId,
  });

  // Best effort. They are already barred from rejoining, which is the part that
  // lasts; failing the request here would tell the host the kick did not work
  // when in every way that matters it did.
  try {
    await removeParticipant({ roomId: input.roomId, userId: input.userId });
  } catch (err) {
    logger.warn('media disconnect failed after kick', { room_id: input.roomId, err });
  }

  await announceSeats(input.roomId);
}
