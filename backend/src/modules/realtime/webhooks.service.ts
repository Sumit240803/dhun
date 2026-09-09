// What the media server tells us happened.
//
// ── The delivery contract, from LiveKit's own docs ───────────────────────────
//
//   "Due to the protocol's push-based nature, there are no guarantees around
//    delivery. LiveKit implements retries and sequences older events before
//    newer ones, but neither guaranteed delivery nor strict ordering."
//
// So every handler here must be safe to run TWICE and safe to MISS entirely.
// The technique used throughout is to write ABSOLUTE state rather than deltas:
//
//   · viewer_count is SET to `room.numParticipants`, never incremented. A
//     missed event self-heals on the next one; an incremented counter would
//     drift forever and there would be no moment at which it got better.
//   · every close is `WHERE ended_at IS NULL`, so a repeat is a no-op.
//   · opening a session relies on the partial unique index, so a duplicate
//     conflicts instead of creating a second open stretch.
//
// A stale `room_finished` cannot end the wrong room: the media room name is
// derived from our room id, and going live again mints a new id, so an old
// event names a room that has already ended.

import { uuidv7 } from 'uuidv7';
import type { WebhookEvent } from 'livekit-server-sdk';
import { pool, withTransaction } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';
import { roomIdFrom } from './realtime.service.js';

/**
 * Applies one verified event.
 *
 * Never throws for an event we do not handle: LiveKit adds event types over
 * time, and a 500 on `track_published` would make it retry forever.
 */
export async function applyWebhookEvent(event: WebhookEvent): Promise<void> {
  const roomName = event.room?.name;
  const roomId = roomName ? roomIdFrom(roomName) : null;

  // A room on this media server that is not ours — another app sharing the
  // deployment, or a stray from a test. Not an error, just not ours.
  if (!roomId) return;

  switch (event.event) {
    case 'room_started':
      // Nothing to do: our row was created when the host went live, which is
      // what caused this. Recorded only so the log tells the whole story.
      logger.info('rtc room started', { room_id: roomId });
      return;

    case 'participant_joined':
    case 'participant_left': {
      const identity = event.participant?.identity;
      if (!identity) return;

      // Absolute, not a delta. See the note at the top.
      await syncViewerCount(roomId, event.room?.numParticipants ?? 0);

      if (event.event === 'participant_joined') {
        await onParticipantJoined(roomId, identity);
      } else {
        await onParticipantLeft(roomId, identity);
      }
      return;
    }

    case 'room_finished':
      await onRoomFinished(roomId);
      return;

    default:
      // track_published, egress_*, ingress_* and anything LiveKit adds later.
      // Ignored deliberately and without complaint.
      return;
  }
}

/**
 * The viewer count shown on every feed card.
 *
 * Written unconditionally from the media server's own number, which is the only
 * source that can be right. `WHERE ended_at IS NULL` stops a late event
 * resurrecting a count on a room that has finished.
 */
async function syncViewerCount(roomId: string, participants: number): Promise<void> {
  await pool.query(
    'UPDATE rooms SET viewer_count = $2 WHERE id = $1 AND ended_at IS NULL',
    [roomId, Math.max(0, participants)],
  );
}

/**
 * The host arriving — including arriving BACK after a dropped connection.
 *
 * A new session stretch opens only if none is open. The partial unique index
 * enforces that even if two events race, and `ON CONFLICT DO NOTHING` turns
 * the loser into a silent no-op rather than a 500 and a retry storm.
 */
async function onParticipantJoined(roomId: string, identity: string): Promise<void> {
  const { rows } = await pool.query<{ host_user_id: string }>(
    'SELECT host_user_id FROM rooms WHERE id = $1 AND ended_at IS NULL',
    [roomId],
  );

  const room = rows[0];
  if (!room || room.host_user_id !== identity) return;

  await pool.query(
    `INSERT INTO room_sessions (id, room_id, host_user_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [uuidv7(), roomId, identity],
  );

  logger.info('host live', { room_id: roomId, user_id: identity });
}

/**
 * Someone left.
 *
 * Two things happen, and they are separate on purpose:
 *
 *   · A SEAT is released. Otherwise a speaker who closed the app holds a mic
 *     nobody can take, and in a room with six seats that is the whole product
 *     broken by one person's flaky signal.
 *
 *   · The HOST's session stretch closes, but the ROOM DOES NOT END. A tunnel is
 *     not a decision to stop broadcasting, and ending the room would scatter an
 *     audience the host spent an hour gathering. The room ends when the host
 *     says so, or when LiveKit's empty timeout fires `room_finished`.
 */
async function onParticipantLeft(roomId: string, identity: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM room_seats WHERE room_id = $1 AND user_id = $2',
      [roomId, identity],
    );

    if (rowCount) {
      await client.query(
        `UPDATE rooms SET seats_taken = GREATEST(0, seats_taken - 1)
          WHERE id = $1 AND ended_at IS NULL`,
        [roomId],
      );
    }

    await client.query(
      `UPDATE room_sessions SET ended_at = now()
        WHERE room_id = $1 AND host_user_id = $2 AND ended_at IS NULL`,
      [roomId, identity],
    );
  });
}

/**
 * The media room is gone — LiveKit's empty timeout expired with nobody in it.
 *
 * `ended_reason = 'timeout'` rather than 'host', because the two are genuinely
 * different: one is someone choosing to stop, the other is a broadcast that
 * died. Only the second is worth investigating, and after the fact they are
 * indistinguishable unless recorded here.
 */
async function onRoomFinished(roomId: string): Promise<void> {
  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE rooms
          SET ended_at = now(), ended_reason = 'timeout', viewer_count = 0, seats_taken = 0
        WHERE id = $1 AND ended_at IS NULL`,
      [roomId],
    );

    // Already ended by the host's own request, which is the ordinary case —
    // we close the media room and this event is the echo of that.
    if (!rowCount) return;

    await client.query(
      'UPDATE room_sessions SET ended_at = now() WHERE room_id = $1 AND ended_at IS NULL',
      [roomId],
    );
    await client.query('DELETE FROM room_seats WHERE room_id = $1', [roomId]);

    logger.warn('room ended by timeout', { room_id: roomId });
  });
}
