// What a moderator can do, and the log that remembers it.
//
// ── Three severities, because the cases are genuinely different ─────────────
//
//   FLAG        Something is off and nobody is sure what. Invisible to the
//               host. Every future go-live is queued for review.
//   END ROOM    Wrong person on camera, but not dangerous. The broadcast
//               closes; the host can start another. A correction, not a
//               punishment.
//   SUSPEND     A suspected minor, or a confirmed handoff. The host cannot go
//               live at all until another human clears it.
//
// One button would be wrong. Ending a room is visible and disruptive — fifty
// people watching, some of whom gifted thirty seconds ago, and it vanishes.
// That is correct for a suspected minor and heavy-handed for an ambiguous
// face, which is why flag-and-watch has to be a real option rather than a
// euphemism for doing nothing.
//
// ── What this deliberately cannot do ────────────────────────────────────────
//
// Reverse a gift. The ledger is append-only and un-sending money is not a
// thing. Suspension stops FUTURE earning; the 7–14 day payout hold is what
// stops past earning from leaving while a human looks. Two levers, and this
// file owns the first one only.

import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';

export type EnforcementAction = 'flag' | 'end_room' | 'suspend' | 'unsuspend' | 'clear_flag';

export interface EnforcementEntry {
  id: string;
  action: EnforcementAction;
  subjectType: 'user' | 'room';
  subjectId: string;
  actorName: string | null;
  source: string;
  note: string | null;
  at: string;
}

/**
 * Take an action, and write down who did it and why.
 *
 * One transaction: the state change and the log entry land together or not at
 * all. A suspension with no log entry is an action nobody can be asked about,
 * and a log entry with no suspension is a lie.
 */
export async function enforce(input: {
  actorId: string;
  action: EnforcementAction;
  subjectType: 'user' | 'room';
  subjectId: string;
  source: 'face_check' | 'report' | 'manual' | 'appeal';
  sourceId?: string;
  note?: string;
}): Promise<void> {
  // Ending a room reaches the media server and the gateway, so it happens
  // outside the transaction — but only after the log is committed, so an
  // action can never be taken without a record of it.
  await withTransaction(async (client) => {
    switch (input.action) {
      case 'flag':
        await client.query('UPDATE users SET host_flagged_at = now() WHERE id = $1', [
          input.subjectId,
        ]);
        break;
      case 'clear_flag':
        await client.query('UPDATE users SET host_flagged_at = NULL WHERE id = $1', [
          input.subjectId,
        ]);
        break;
      case 'suspend':
        await client.query('UPDATE users SET host_suspended_at = now() WHERE id = $1', [
          input.subjectId,
        ]);
        break;
      case 'unsuspend':
        await client.query('UPDATE users SET host_suspended_at = NULL WHERE id = $1', [
          input.subjectId,
        ]);
        break;
      case 'end_room':
        // Nothing to write on the user; the room is closed below.
        break;
    }

    await client.query(
      `INSERT INTO enforcement_actions
         (id, actor_id, subject_type, subject_id, action, source, source_id, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        uuidv7(),
        input.actorId,
        input.subjectType,
        input.subjectId,
        input.action,
        input.source,
        input.sourceId ?? null,
        input.note ?? null,
      ],
    );
  });

  if (input.action === 'end_room') {
    await closeRoom(input.subjectId);
  }

  // A suspension must also close whatever they are broadcasting right now —
  // otherwise "cannot go live" means "cannot go live AGAIN", and the stream
  // that caused the suspension carries on.
  if (input.action === 'suspend') {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM rooms WHERE host_user_id = $1 AND ended_at IS NULL',
      [input.subjectId],
    );
    for (const row of rows) await closeRoom(row.id);
  }

  logger.warn('enforcement action', {
    actor_id: input.actorId,
    action: input.action,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    source: input.source,
  });
}

/** Everything ever done to this subject, newest first. */
export async function enforcementHistory(
  subjectType: 'user' | 'room',
  subjectId: string,
  limit = 50,
): Promise<EnforcementEntry[]> {
  const { rows } = await pool.query<{
    id: string;
    action: EnforcementAction;
    subject_type: 'user' | 'room';
    subject_id: string;
    actor_name: string | null;
    source: string;
    note: string | null;
    created_at: Date;
  }>(
    `SELECT e.id, e.action, e.subject_type, e.subject_id, p.display_name AS actor_name,
            e.source, e.note, e.created_at
       FROM enforcement_actions e
       LEFT JOIN user_profiles p ON p.user_id = e.actor_id
      WHERE e.subject_type = $1 AND e.subject_id = $2
      ORDER BY e.created_at DESC
      LIMIT $3`,
    [subjectType, subjectId, limit],
  );
  return rows.map(toEntry);
}

/** The whole log, newest first. The back-office front page. */
export async function recentEnforcement(limit = 100): Promise<EnforcementEntry[]> {
  const { rows } = await pool.query<{
    id: string;
    action: EnforcementAction;
    subject_type: 'user' | 'room';
    subject_id: string;
    actor_name: string | null;
    source: string;
    note: string | null;
    created_at: Date;
  }>(
    `SELECT e.id, e.action, e.subject_type, e.subject_id, p.display_name AS actor_name,
            e.source, e.note, e.created_at
       FROM enforcement_actions e
       LEFT JOIN user_profiles p ON p.user_id = e.actor_id
      ORDER BY e.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(toEntry);
}

function toEntry(row: {
  id: string;
  action: EnforcementAction;
  subject_type: 'user' | 'room';
  subject_id: string;
  actor_name: string | null;
  source: string;
  note: string | null;
  created_at: Date;
}): EnforcementEntry {
  return {
    id: row.id,
    action: row.action,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    actorName: row.actor_name,
    source: row.source,
    note: row.note,
    at: row.created_at.toISOString(),
  };
}

/**
 * Closes a room on a moderator's behalf.
 *
 * A DEFERRED import, because `rooms` imports this module for its go-live gate
 * and a static import here would make the two load each other. The same
 * technique `payments` uses to reach `economy`. Deferring is safe and honest
 * here: by the time anybody is enforcing anything, every module has loaded.
 */
async function closeRoom(roomId: string): Promise<void> {
  const { endRoomAsModerator } = await import('../rooms/index.js');
  await endRoomAsModerator(roomId);
}

/** Guards an action against a subject that does not exist. */
export async function assertSubjectExists(
  subjectType: 'user' | 'room',
  subjectId: string,
): Promise<void> {
  const table = subjectType === 'user' ? 'users' : 'rooms';
  const { rowCount } = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [subjectId]);
  if (rowCount === 0) {
    throw new AppError('SUBJECT_NOT_FOUND', 'That user or room does not exist', 404);
  }
}
