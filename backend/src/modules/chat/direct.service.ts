// Private messages between two people.
//
// The thread list and the read watermark existed since M5 for official
// messages; this is the send path. Three rules carried from everywhere else
// text travels in this app:
//
//   · A block in either direction closes the door, silently to the blocker.
//   · Every message goes through the same filter as room chat. A blocked
//     message is recorded nowhere and the sender is told — a DM is private,
//     but "share your WhatsApp number" patterns are exactly what the safety
//     doc wants caught, and they are caught here too.
//   · Official threads are read-only. The platform talks; nobody replies.

import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { isBlockedBetween } from '../moderation/index.js';
import { filterText } from '../moderation/textFilter.js';
import type { ThreadMessage } from './threads.service.js';

export interface DirectThread {
  id: string;
  title: string;
  avatarUrl: string | null;
}

function directKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/** The thread between these two, created if it does not exist yet. */
export async function openDirectThread(userId: string, otherId: string): Promise<DirectThread> {
  if (userId === otherId) throw new AppError('CANNOT_MESSAGE_SELF', 'That is you', 422);

  const { rows } = await pool.query<{ status: string; display_name: string | null; avatar_url: string | null }>(
    `SELECT u.status, p.display_name, p.avatar_url
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = $1`,
    [otherId],
  );
  const other = rows[0];
  if (!other || other.status !== 'active') {
    throw new AppError('USER_NOT_FOUND', 'That account does not exist', 404);
  }
  // Same answer whichever side blocked: the blocker's choice stays theirs.
  if (await isBlockedBetween(userId, otherId)) {
    throw new AppError('USER_NOT_FOUND', 'That account does not exist', 404);
  }

  const key = directKey(userId, otherId);
  const id = await withTransaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM message_threads WHERE direct_key = $1',
      [key],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const threadId = uuidv7();
    await client.query(
      `INSERT INTO message_threads (id, kind, direct_key) VALUES ($1, 'direct', $2)
       ON CONFLICT (direct_key) DO NOTHING`,
      [threadId, key],
    );
    // Lost the race to the other person's tap: use theirs.
    const won = await client.query<{ id: string }>(
      'SELECT id FROM message_threads WHERE direct_key = $1',
      [key],
    );
    const finalId = won.rows[0]!.id;
    await client.query(
      `INSERT INTO thread_participants (thread_id, user_id) VALUES ($1, $2), ($1, $3)
       ON CONFLICT DO NOTHING`,
      [finalId, userId, otherId],
    );
    return finalId;
  });

  return { id, title: other.display_name ?? 'Chat', avatarUrl: other.avatar_url };
}

export async function sendMessage(input: {
  userId: string;
  threadId: string;
  body: string;
}): Promise<ThreadMessage> {
  const { rows } = await pool.query<{ kind: string; other_id: string | null }>(
    `SELECT t.kind,
            (SELECT o.user_id FROM thread_participants o
              WHERE o.thread_id = t.id AND o.user_id <> $2 LIMIT 1) AS other_id
       FROM message_threads t
       JOIN thread_participants tp ON tp.thread_id = t.id AND tp.user_id = $2
      WHERE t.id = $1`,
    [input.threadId, input.userId],
  );
  const thread = rows[0];
  if (!thread) throw new AppError('THREAD_NOT_FOUND', 'That conversation does not exist', 404);
  if (thread.kind === 'official') {
    throw new AppError('THREAD_READ_ONLY', 'You cannot reply to an official message', 409);
  }
  if (thread.other_id && (await isBlockedBetween(input.userId, thread.other_id))) {
    throw new AppError('THREAD_NOT_FOUND', 'That conversation does not exist', 404);
  }

  const body = input.body.trim();
  const result = filterText(body);
  if (result.verdict === 'blocked') {
    throw new AppError('MESSAGE_BLOCKED', 'That message was not sent', 422);
  }

  const id = uuidv7();
  const { rows: inserted } = await pool.query<{ created_at: Date; display_name: string | null }>(
    `WITH m AS (
       INSERT INTO messages (id, thread_id, sender_user_id, body) VALUES ($1, $2, $3, $4)
       RETURNING created_at
     ), bump AS (
       UPDATE message_threads SET updated_at = now() WHERE id = $2
     )
     SELECT m.created_at, p.display_name FROM m LEFT JOIN user_profiles p ON p.user_id = $3`,
    [id, input.threadId, input.userId, result.body],
  );

  return {
    id,
    body: result.body,
    createdAt: inserted[0]!.created_at,
    senderId: input.userId,
    senderName: inserted[0]!.display_name,
    mine: true,
  };
}
