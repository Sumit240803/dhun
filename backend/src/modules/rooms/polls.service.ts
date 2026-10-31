// Polls: a host asks the room, the room answers, once each, for free.
//
// Nothing here is paid and nothing is won. A poll whose vote cost coins, or
// whose result paid anyone, would be a wager on an outcome — hard rule #1 —
// so the service has no price, no prize and no import from economy.
//
// Tallies are COUNTED from the votes on every read, never kept in a column:
// a count that can drift from the rows under it is the kind of number a
// screenshot argument gets started over.

import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { publishToRoom } from '../../infra/roomBus.js';
import { getConfigValue } from '../economy/index.js';

export interface PollView {
  id: string;
  question: string;
  options: { text: string; votes: number }[];
  total: number;
  endsAt: string;
  /** Set when the host closed it or the clock ran out. */
  closedAt: string | null;
  /** The reader's own choice; null when they have not voted. Never broadcast. */
  myVote: number | null;
}

const pollsConfigSchema = z
  .object({
    durationsSeconds: z.array(z.number().int().min(15).max(3_600)).min(1).max(6),
    defaultSeconds: z.number().int().min(15).max(3_600),
  })
  .strict();

const DEFAULTS = { durationsSeconds: [60, 120, 300], defaultSeconds: 120 };

export async function pollsConfig(): Promise<z.infer<typeof pollsConfigSchema>> {
  const parsed = pollsConfigSchema.safeParse(await getConfigValue('polls'));
  return parsed.success ? parsed.data : DEFAULTS;
}

interface Row {
  id: string;
  room_id: string;
  question: string;
  options: string[];
  ends_at: Date;
  closed_at: Date | null;
}

async function loadPoll(roomId: string, pollId: string): Promise<Row> {
  const { rows } = await pool.query<Row>(
    'SELECT id, room_id, question, options, ends_at, closed_at FROM room_polls WHERE id = $1 AND room_id = $2',
    [pollId, roomId],
  );
  if (!rows[0]) throw new AppError('POLL_NOT_FOUND', 'That poll does not exist', 404);
  return rows[0];
}

async function view(row: Row, viewerId?: string): Promise<PollView> {
  const [tally, mine] = await Promise.all([
    pool.query<{ option_index: number; votes: string }>(
      'SELECT option_index, count(*) AS votes FROM room_poll_votes WHERE poll_id = $1 GROUP BY option_index',
      [row.id],
    ),
    viewerId
      ? pool.query<{ option_index: number }>(
          'SELECT option_index FROM room_poll_votes WHERE poll_id = $1 AND user_id = $2',
          [row.id, viewerId],
        )
      : Promise.resolve({ rows: [] as { option_index: number }[] }),
  ]);
  const counts = new Map(tally.rows.map((r) => [r.option_index, Number(r.votes)]));
  const options = row.options.map((text, index) => ({ text, votes: counts.get(index) ?? 0 }));
  // The clock closing it is as final as the host closing it.
  const expired = row.closed_at === null && row.ends_at.getTime() <= Date.now();
  return {
    id: row.id,
    question: row.question,
    options,
    total: options.reduce((sum, o) => sum + o.votes, 0),
    endsAt: row.ends_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? (expired ? row.ends_at.toISOString() : null),
    myVote: mine.rows[0]?.option_index ?? null,
  };
}

async function assertHostOrAdmin(roomId: string, actorId: string): Promise<void> {
  const { rows } = await pool.query<{ host_user_id: string; ended_at: Date | null }>(
    'SELECT host_user_id, ended_at FROM rooms WHERE id = $1',
    [roomId],
  );
  const room = rows[0];
  if (!room) throw new AppError('ROOM_NOT_FOUND', 'That room does not exist', 404);
  if (room.ended_at !== null) throw new AppError('ROOM_ENDED', 'This room has ended', 410);
  if (room.host_user_id === actorId) return;
  const { rowCount } = await pool.query(
    'SELECT 1 FROM room_admins WHERE room_id = $1 AND user_id = $2',
    [roomId, actorId],
  );
  if (!rowCount) throw new AppError('NOT_ROOM_HOST', 'Only the host or an admin can do that', 403);
}

/** Tells everyone in the room. Without `myVote` — that is each reader's own. */
function announce(roomId: string, poll: PollView | null): void {
  publishToRoom(roomId, { t: 'poll', roomId, poll: poll ? { ...poll, myVote: null } : null });
}

export async function createPoll(input: {
  roomId: string;
  actorId: string;
  question: string;
  options: string[];
  durationSeconds?: number;
}): Promise<PollView> {
  await assertHostOrAdmin(input.roomId, input.actorId);
  const config = await pollsConfig();
  const seconds = input.durationSeconds ?? config.defaultSeconds;
  if (!config.durationsSeconds.includes(seconds)) {
    throw new AppError('VALIDATION_FAILED', 'That poll length is not offered', 422, {
      issues: [{ field: 'durationSeconds', code: 'invalid_enum_value', message: 'Not an offered length' }],
    });
  }
  // Two identical options is a poll nobody can answer.
  if (new Set(input.options.map((o) => o.trim().toLowerCase())).size !== input.options.length) {
    throw new AppError('VALIDATION_FAILED', 'Options must differ', 422, {
      issues: [{ field: 'options', code: 'custom', message: 'Options must differ' }],
    });
  }

  // The previous poll, if still open, is closed by the new one rather than
  // refused: a host who asks the next question has moved on from the last.
  await pool.query(
    'UPDATE room_polls SET closed_at = now() WHERE room_id = $1 AND closed_at IS NULL',
    [input.roomId],
  );

  const id = uuidv7();
  const { rows } = await pool.query<Row>(
    `INSERT INTO room_polls (id, room_id, created_by, question, options, ends_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now() + make_interval(secs => $6))
     RETURNING id, room_id, question, options, ends_at, closed_at`,
    [id, input.roomId, input.actorId, input.question, JSON.stringify(input.options), seconds],
  );
  const poll = await view(rows[0]);
  announce(input.roomId, poll);
  return poll;
}

export async function vote(input: {
  roomId: string;
  pollId: string;
  userId: string;
  optionIndex: number;
}): Promise<PollView> {
  const row = await loadPoll(input.roomId, input.pollId);
  if (row.closed_at !== null || row.ends_at.getTime() <= Date.now()) {
    throw new AppError('POLL_CLOSED', 'This poll has ended', 409);
  }
  if (input.optionIndex >= row.options.length) {
    throw new AppError('VALIDATION_FAILED', 'No such option', 422, {
      issues: [{ field: 'optionIndex', code: 'too_big', message: 'No such option' }],
    });
  }
  const banned = await pool.query('SELECT 1 FROM room_bans WHERE room_id = $1 AND user_id = $2', [
    input.roomId,
    input.userId,
  ]);
  if (banned.rowCount) throw new AppError('ROOM_BANNED', 'You cannot vote in this room', 403);

  // One vote each; a second tap is a change of mind, not a second vote.
  await pool.query(
    `INSERT INTO room_poll_votes (poll_id, user_id, option_index) VALUES ($1, $2, $3)
     ON CONFLICT (poll_id, user_id) DO UPDATE SET option_index = EXCLUDED.option_index`,
    [row.id, input.userId, input.optionIndex],
  );
  const poll = await view(row, input.userId);
  announce(input.roomId, poll);
  return poll;
}

export async function closePoll(input: { roomId: string; pollId: string; actorId: string }): Promise<PollView> {
  await assertHostOrAdmin(input.roomId, input.actorId);
  const { rows } = await pool.query<Row>(
    `UPDATE room_polls SET closed_at = COALESCE(closed_at, now())
      WHERE id = $1 AND room_id = $2
      RETURNING id, room_id, question, options, ends_at, closed_at`,
    [input.pollId, input.roomId],
  );
  if (!rows[0]) throw new AppError('POLL_NOT_FOUND', 'That poll does not exist', 404);
  const poll = await view(rows[0], input.actorId);
  announce(input.roomId, poll);
  return poll;
}

/**
 * The poll a viewer should see on arrival: the open one, or one that ended
 * in the last half minute so the result is still on screen. Null otherwise.
 */
export async function currentPoll(roomId: string, viewerId?: string): Promise<PollView | null> {
  const { rows } = await pool.query<Row>(
    `SELECT id, room_id, question, options, ends_at, closed_at
       FROM room_polls
      WHERE room_id = $1
        AND COALESCE(closed_at, ends_at) > now() - interval '30 seconds'
      ORDER BY created_at DESC
      LIMIT 1`,
    [roomId],
  );
  return rows[0] ? view(rows[0], viewerId) : null;
}
