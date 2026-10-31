// Reading the event log (migration 038). Writing is `infra/eventLog.ts`.
//
// Two shapes, because an operator asks two questions: "what is breaking right
// now" — the fingerprint groups, counted — and "what happened to THIS user /
// request / job" — the filtered list.

import { pool } from '../../infra/db.js';
import type { EventLevel, EventProcess } from '../../infra/eventLog.js';

export interface SystemEvent {
  id: string;
  occurredAt: string;
  process: EventProcess;
  level: EventLevel;
  kind: string;
  event: string;
  code: string | null;
  message: string | null;
  fingerprint: string;
  traceId: string | null;
  userId: string | null;
  path: string | null;
  meta: Record<string, unknown>;
}

export interface EventFilter {
  level?: EventLevel;
  kind?: string;
  process?: EventProcess;
  /** Prefix match on `event` or exact match on `code`. */
  q?: string;
  userId?: string;
  traceId?: string;
  fingerprint?: string;
  limit?: number;
}

export interface FingerprintGroup {
  fingerprint: string;
  level: EventLevel;
  process: EventProcess;
  event: string;
  code: string | null;
  message: string | null;
  count: number;
  users: number;
  firstAt: string;
  lastAt: string;
}

export interface EventCounts {
  errors: number;
  warns: number;
  infos: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  occurred_at: Date;
  process: EventProcess;
  level: EventLevel;
  kind: string;
  event: string;
  code: string | null;
  message: string | null;
  fingerprint: string;
  trace_id: string | null;
  user_id: string | null;
  path: string | null;
  meta: Record<string, unknown>;
}

function toEvent(row: Row): SystemEvent {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    process: row.process,
    level: row.level,
    kind: row.kind,
    event: row.event,
    code: row.code,
    message: row.message,
    fingerprint: row.fingerprint,
    traceId: row.trace_id,
    userId: row.user_id,
    path: row.path,
    meta: row.meta ?? {},
  };
}

/** Newest first, filtered. Every filter is parameterised; nothing is interpolated. */
export async function listEvents(filter: EventFilter = {}): Promise<SystemEvent[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  if (filter.level) add('level = ?', filter.level);
  if (filter.kind) add('kind = ?', filter.kind);
  if (filter.process) add('process = ?', filter.process);
  if (filter.fingerprint) add('fingerprint = ?', filter.fingerprint);
  if (filter.traceId) add('trace_id = ?', filter.traceId);
  if (filter.userId && UUID.test(filter.userId)) add('user_id = ?', filter.userId);
  if (filter.q) {
    const q = filter.q.trim().slice(0, 64);
    if (q) {
      params.push(q);
      // `event` is a prefix search (type "auth." for the whole auth trail);
      // `code` is exact, because codes are short and people paste them whole.
      where.push(`(event LIKE $${params.length} || '%' OR code = $${params.length})`);
    }
  }

  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  params.push(limit);

  const { rows } = await pool.query<Row>(
    `SELECT id, occurred_at, process, level, kind, event, code, message, fingerprint,
            trace_id, user_id, path, meta
       FROM system_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY occurred_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map(toEvent);
}

/**
 * Warnings and errors in the last `hours`, grouped by fingerprint, worst first.
 *
 * `message` is the most recent one in the group — the same bug can carry
 * different messages, which is why grouping is by fingerprint and not by text.
 */
export async function topFingerprints(hours = 24, limit = 25): Promise<FingerprintGroup[]> {
  const { rows } = await pool.query<{
    fingerprint: string;
    level: EventLevel;
    process: EventProcess;
    event: string;
    code: string | null;
    message: string | null;
    count: string;
    users: string;
    first_at: Date;
    last_at: Date;
  }>(
    `WITH grouped AS (
       SELECT fingerprint,
              max(level) FILTER (WHERE level = 'error') IS NOT NULL AS is_error,
              count(*)::bigint AS count,
              count(DISTINCT user_id)::bigint AS users,
              min(occurred_at) AS first_at,
              max(occurred_at) AS last_at
         FROM system_events
        WHERE level IN ('warn', 'error')
          AND occurred_at > now() - make_interval(hours => $1)
        GROUP BY fingerprint
     )
     SELECT g.fingerprint,
            CASE WHEN g.is_error THEN 'error' ELSE 'warn' END AS level,
            latest.process, latest.event, latest.code, latest.message,
            g.count, g.users, g.first_at, g.last_at
       FROM grouped g
       JOIN LATERAL (
         SELECT process, event, code, message
           FROM system_events e
          WHERE e.fingerprint = g.fingerprint
          ORDER BY occurred_at DESC
          LIMIT 1
       ) latest ON true
      ORDER BY g.is_error DESC, g.count DESC, g.last_at DESC
      LIMIT $2`,
    [Math.min(Math.max(hours, 1), 24 * 30), Math.min(Math.max(limit, 1), 100)],
  );

  return rows.map((row) => ({
    fingerprint: row.fingerprint,
    level: row.level,
    process: row.process,
    event: row.event,
    code: row.code,
    message: row.message,
    count: Number(row.count),
    users: Number(row.users),
    firstAt: row.first_at.toISOString(),
    lastAt: row.last_at.toISOString(),
  }));
}

/** The three numbers at the top of the screen. */
export async function eventCounts(hours = 24): Promise<EventCounts> {
  const { rows } = await pool.query<{ level: EventLevel; count: string }>(
    `SELECT level, count(*)::bigint AS count
       FROM system_events
      WHERE occurred_at > now() - make_interval(hours => $1)
      GROUP BY level`,
    [Math.min(Math.max(hours, 1), 24 * 30)],
  );
  const counts: EventCounts = { errors: 0, warns: 0, infos: 0 };
  for (const row of rows) {
    if (row.level === 'error') counts.errors = Number(row.count);
    else if (row.level === 'warn') counts.warns = Number(row.count);
    else counts.infos = Number(row.count);
  }
  return counts;
}
