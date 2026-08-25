import { pool } from '../../infra/db.js';

export type ThreadFilter = 'all' | 'official' | 'unread' | 'groups';

export interface ThreadSummary {
  id: string;
  title: string;
  preview: string;
  updatedAt: Date;
  unread: number;
  official: boolean;
  group: boolean;
  avatarUrl: string | null;
  accent: 'money' | 'security' | 'system' | 'person';
}

interface Row {
  id: string;
  kind: string;
  title: string | null;
  accent: string | null;
  preview: string | null;
  last_at: Date | null;
  unread: string;
  other_name: string | null;
  other_avatar: string | null;
}

/**
 * The message list.
 *
 * Unread is counted from a WATERMARK (`last_read_at`) rather than a stored
 * counter. A counter has to be decremented correctly from several places and
 * drifts the first time one of them is missed; a watermark is idempotent, and
 * it stays right when a message is deleted.
 *
 * The preview and the timestamp come from a LATERAL, which is a per-thread
 * index seek rather than a sort over every message the user has ever received.
 */
export async function listThreads(input: {
  userId: string;
  filter: ThreadFilter;
  limit: number;
}): Promise<ThreadSummary[]> {
  const filters: string[] = ['tp.user_id = $1'];

  if (input.filter === 'official') filters.push("t.kind = 'official'");
  if (input.filter === 'groups') filters.push("t.kind = 'group'");
  if (input.filter === 'unread') filters.push('unread.count > 0');

  const { rows } = await pool.query<Row>(
    `SELECT t.id,
            t.kind,
            t.title,
            t.accent,
            last.body        AS preview,
            last.created_at  AS last_at,
            unread.count     AS unread,
            other.display_name AS other_name,
            other.avatar_url   AS other_avatar
       FROM thread_participants tp
       JOIN message_threads t ON t.id = tp.thread_id

       LEFT JOIN LATERAL (
         SELECT m.body, m.created_at
           FROM messages m
          WHERE m.thread_id = t.id
          -- id breaks the tie: two messages in the same millisecond is normal
          -- in a chat, and uuidv7 is time-ordered so this stays chronological.
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 1
       ) last ON true

       LEFT JOIN LATERAL (
         SELECT count(*)::int AS count
           FROM messages m
          WHERE m.thread_id = t.id
            AND m.created_at > COALESCE(tp.last_read_at, '-infinity'::timestamptz)
            AND m.sender_user_id IS DISTINCT FROM tp.user_id
       ) unread ON true

       -- The other side of a DIRECT thread, for its title and avatar. A direct
       -- thread stores no title of its own: it is named for whoever you are
       -- talking to, and that name changes when they rename themselves.
       LEFT JOIN LATERAL (
         SELECT p.display_name, p.avatar_url
           FROM thread_participants other_tp
           JOIN user_profiles p ON p.user_id = other_tp.user_id
          WHERE other_tp.thread_id = t.id
            AND other_tp.user_id <> tp.user_id
          LIMIT 1
       ) other ON t.kind = 'direct'

      WHERE ${filters.join(' AND ')}
      ORDER BY COALESCE(last.created_at, t.created_at) DESC, t.id DESC
      LIMIT $2`,
    [input.userId, input.limit],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? row.other_name ?? 'Chat',
    preview: row.preview ?? '',
    updatedAt: row.last_at ?? new Date(),
    unread: Number(row.unread ?? 0),
    official: row.kind === 'official',
    group: row.kind === 'group',
    avatarUrl: row.other_avatar,
    accent: (row.accent as ThreadSummary['accent'] | null) ?? 'person',
  }));
}
