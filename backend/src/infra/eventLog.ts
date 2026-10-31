// The event log: important events and every error, kept in Postgres.
//
// `logger` writes a JSON line to stdout and forgets it. This keeps the lines
// that matter (migration 038): every error from any of the three processes,
// security signals, the audit trail of who did what, failed jobs, alerts, and
// what the app reports about itself. The admin panel reads it at /admin/events.
//
// Three properties, in order of importance:
//
//   1. **It can never hurt the request that called it.** `recordEvent` is
//      synchronous, never throws, never awaits the database. Rows are buffered
//      and written in batches by a timer. If Postgres is down the batch is
//      dropped with one line on stderr — losing a log row is acceptable;
//      failing a gift because the log was slow is not.
//   2. **Nothing secret reaches the table.** Meta is sanitised by KEY NAME
//      (password, token, secret, authkey, otp, pan …), strings are capped,
//      depth is capped, and the whole object is capped at 8 KB. The MSG91
//      authkey, a JWT, a refresh token or a PAN must never be one `meta` away
//      from a browser session. Sanitising by name is a floor, not a ceiling —
//      callers still choose what to pass.
//   3. **Repeats group.** A fingerprint of process + event + code + the first
//      stack frame turns two hundred copies of one bug into one row with a
//      count, which is what the burst check and the admin screen key on.
//
// This file deliberately does NOT import `logger`: the logger calls into here
// for `error`, and a failure here must not loop back into it.

import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { pool } from './db.js';
import { currentContext } from './context.js';

export type EventLevel = 'info' | 'warn' | 'error';
export type EventProcess = 'api' | 'gateway' | 'workers' | 'app';

/** Coarse categories — the filter rail on the admin screen. Add sparingly. */
export type EventKind =
  | 'error'
  | 'security'
  | 'auth'
  | 'account'
  | 'money'
  | 'moderation'
  | 'config'
  | 'room'
  | 'job'
  | 'alert'
  | 'app';

export interface EventInput {
  level: EventLevel;
  kind: EventKind;
  /** `noun.verb`, stable: it is what people filter and alert on. */
  event: string;
  message?: string;
  /** The stable error code when there is one. */
  code?: string;
  /** Defaults to the request context's user, when there is one. */
  userId?: string | null;
  traceId?: string | null;
  path?: string | null;
  /** Sanitised before storage. Keep it small and specific. */
  meta?: Record<string, unknown>;
  /** An Error (or anything thrown) to flatten into meta.err and the fingerprint. */
  err?: unknown;
  process?: EventProcess;
  occurredAt?: Date;
}

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
  meta: string;
}

// ── Limits ──────────────────────────────────────────────────────────────────

const MAX_QUEUE = 1_000;
const FLUSH_EVERY_MS = 1_000;
const FLUSH_AT = 100;
const MAX_STRING = 500;
const MAX_STACK = 2_000;
const MAX_DEPTH = 3;
const MAX_KEYS = 40;
const MAX_META_BYTES = 8 * 1024;

/**
 * Key names whose values are never stored, whatever they hold.
 *
 * Matched case-insensitively as a substring, so `accessToken`, `refresh_token`,
 * `MSG91_AUTH_KEY`, `otpCode` and `panNumber` are all caught. `code` alone is
 * NOT in the list — it is the error code on nearly every row — which is why
 * the OTP and email flows name theirs `otp`/`devCode`, both matched.
 */
const SECRET_KEY = /password|passwd|secret|token|authkey|auth_key|authorization|cookie|otp|devcode|pan\b|pan_|pannumber|aadhaar|account_number|ifsc|card/i;

// ── State ───────────────────────────────────────────────────────────────────

let processName: EventProcess = 'api';
let queue: Row[] = [];
let timer: NodeJS.Timeout | undefined;
let flushing: Promise<void> | undefined;
let dropped = 0;
let enabled = true;

/** Each entry point names itself once; rows carry it so the screen can filter by process. */
export function setEventLogProcess(name: EventProcess): void {
  processName = name;
}

/** Tests that count rows turn the automatic logger hook off while they set up. */
export function setEventLogEnabled(on: boolean): void {
  enabled = on;
}

// ── Sanitising ──────────────────────────────────────────────────────────────

function clip(value: string, max = MAX_STRING): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function sanitiseValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return clip(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return flattenError(value);
  if (depth >= MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => sanitiseValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (n++ >= MAX_KEYS) {
        out['…'] = '[more keys]';
        break;
      }
      out[clip(key, 64)] = SECRET_KEY.test(key) ? '[redacted]' : sanitiseValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Errors lose message and stack under JSON.stringify, so they are flattened by hand. */
function flattenError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const out: Record<string, unknown> = {
      name: err.name,
      message: clip(err.message),
      ...(err.stack ? { stack: clip(err.stack, MAX_STACK) } : {}),
    };
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') out.code = code;
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') out.status = status;
    return out;
  }
  return { value: clip(String(err)) };
}

/**
 * What gets stored as `meta`. Exported for the tests, which prove that a token
 * passed by mistake does not reach the table.
 */
export function sanitiseMeta(meta: Record<string, unknown> | undefined, err?: unknown): Record<string, unknown> {
  const base = (sanitiseValue(meta ?? {}, 0) as Record<string, unknown>) ?? {};
  if (err !== undefined) base.err = flattenError(err);

  let json = JSON.stringify(base);
  if (json.length <= MAX_META_BYTES) return base;

  // Too big even after clipping: keep the error and the first few keys, say so.
  const trimmed: Record<string, unknown> = {};
  if (base.err) trimmed.err = base.err;
  for (const [key, value] of Object.entries(base)) {
    if (key === 'err') continue;
    const candidate = { ...trimmed, [key]: value };
    json = JSON.stringify(candidate);
    if (json.length > MAX_META_BYTES) break;
    trimmed[key] = value;
  }
  trimmed['…'] = '[meta truncated]';
  return trimmed;
}

// ── Fingerprint ─────────────────────────────────────────────────────────────

/** The first frame of a stack that is ours, so two throws of one bug match whatever message they carry. */
function firstFrame(err: unknown): string | undefined {
  if (!(err instanceof Error) || !err.stack) return undefined;
  const frames = err.stack.split('\n').slice(1).map((line) => line.trim());
  const ours = frames.find((f) => f.includes('/src/') || f.includes('\\src\\')) ?? frames[0];
  // Strip the column so a one-line edit upstream does not re-key every row.
  return ours?.replace(/:\d+\)?$/, '');
}

export function fingerprintOf(input: {
  process: EventProcess;
  event: string;
  code?: string | null;
  message?: string | null;
  err?: unknown;
}): string {
  const anchor = firstFrame(input.err) ?? input.message ?? '';
  return createHash('sha256')
    .update(`${input.process}|${input.event}|${input.code ?? ''}|${anchor}`)
    .digest('hex')
    .slice(0, 16);
}

// ── Recording ───────────────────────────────────────────────────────────────

/**
 * Queue one event. Synchronous, never throws, never waits on the database.
 *
 * The request context fills in the trace id, the user and the path when the
 * caller does not, so a row written from deep inside a service still ties
 * back to the request that caused it.
 */
export function recordEvent(input: EventInput): void {
  if (!enabled) return;
  try {
    const ctx = currentContext();
    const proc = input.process ?? processName;
    const message =
      input.message ?? (input.err instanceof Error ? input.err.message : undefined);

    const row: Row = {
      id: uuidv7(),
      occurred_at: input.occurredAt ?? new Date(),
      process: proc,
      level: input.level,
      kind: clip(input.kind, 32),
      event: clip(input.event, 64),
      code: input.code ? clip(input.code, 64) : null,
      message: message ? clip(message) : null,
      fingerprint: fingerprintOf({ process: proc, event: input.event, code: input.code, message, err: input.err }),
      trace_id: clip(input.traceId ?? ctx?.traceId ?? '', 64) || null,
      user_id: input.userId ?? ctx?.userId ?? null,
      path: clip(input.path ?? ctx?.path ?? '', 200) || null,
      meta: JSON.stringify(sanitiseMeta(input.meta, input.err)),
    };

    if (queue.length >= MAX_QUEUE) {
      // Keep the oldest: during an incident the first rows explain the rest.
      dropped++;
      return;
    }
    queue.push(row);

    if (queue.length >= FLUSH_AT) void flushEvents();
    else if (!timer) {
      timer = setTimeout(() => void flushEvents(), FLUSH_EVERY_MS);
      // A pending flush must never hold a process open — tests and `worker:run`
      // exit when their work is done, and the shutdown path flushes explicitly.
      timer.unref();
    }
  } catch (err) {
    process.stderr.write(`{"level":"error","msg":"event log record failed","err":${JSON.stringify(String(err))}}\n`);
  }
}

/**
 * Write everything queued. Called by the timer, at FLUSH_AT, and by each
 * process's shutdown so a crash's last words are not lost with it.
 *
 * Concurrent callers share one in-flight write rather than racing the pool.
 */
export async function flushEvents(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (flushing) {
    await flushing;
    if (queue.length === 0) return;
  }
  if (queue.length === 0) return;

  const batch = queue;
  queue = [];
  const lost = dropped;
  dropped = 0;

  flushing = writeBatch(batch, lost).finally(() => {
    flushing = undefined;
  });
  await flushing;
}

async function writeBatch(batch: Row[], lost: number): Promise<void> {
  if (lost > 0) {
    batch.push({
      id: uuidv7(),
      occurred_at: new Date(),
      process: processName,
      level: 'warn',
      kind: 'error',
      event: 'event_log.dropped',
      code: null,
      message: `${lost} events dropped: queue full`,
      fingerprint: fingerprintOf({ process: processName, event: 'event_log.dropped' }),
      trace_id: null,
      user_id: null,
      path: null,
      meta: JSON.stringify({ dropped: lost }),
    });
  }

  const values: unknown[] = [];
  const tuples = batch.map((row, i) => {
    const b = i * 13;
    values.push(
      row.id,
      row.occurred_at,
      row.process,
      row.level,
      row.kind,
      row.event,
      row.code,
      row.message,
      row.fingerprint,
      row.trace_id,
      row.user_id,
      row.path,
      row.meta,
    );
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}::jsonb)`;
  });

  try {
    await pool.query(
      `INSERT INTO system_events
         (id, occurred_at, process, level, kind, event, code, message, fingerprint, trace_id, user_id, path, meta)
       VALUES ${tuples.join(', ')}`,
      values,
    );
  } catch (err) {
    // Not via logger: it would call back into here. One line, the batch is gone.
    process.stderr.write(
      `{"level":"error","msg":"event log write failed","dropped":${batch.length},"err":${JSON.stringify(
        err instanceof Error ? err.message : String(err),
      )}}\n`,
    );
  }
}

/** Tests only: forget anything queued without writing it. */
export function discardQueuedEvents(): void {
  queue = [];
  dropped = 0;
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
}
