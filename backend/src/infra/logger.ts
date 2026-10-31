// Structured logging. One JSON object per line, so ClickHouse and CloudWatch can
// both parse it without a regex.
//
// trace_id is pulled from the async context rather than passed in, which means
// no call site can forget it.
import { currentContext } from './context.js';
import { recordEvent } from './eventLog.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;

  const ctx = currentContext();
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx?.traceId ? { trace_id: ctx.traceId } : {}),
    ...(ctx?.userId ? { user_id: ctx.userId } : {}),
    ...(ctx?.path ? { path: ctx.path } : {}),
    ...meta,
  };

  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + '\n');
}

/** Errors are flattened by hand: JSON.stringify drops message and stack otherwise. */
function serialiseError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      err: {
        name: err.name,
        message: err.message,
        stack: err.stack,
        ...('code' in err ? { code: (err as { code?: string }).code } : {}),
      },
    };
  }
  return { err };
}

/**
 * Set `skipEventLog: true` in meta when the caller has ALREADY recorded the
 * event itself (an alert, a request the error handler stored) so one incident
 * does not appear twice on /admin/events. Stripped before the line is written.
 */
function stripControl(meta?: Record<string, unknown>): {
  meta: Record<string, unknown> | undefined;
  skip: boolean;
} {
  if (!meta || !('skipEventLog' in meta)) return { meta, skip: false };
  const { skipEventLog, ...rest } = meta;
  return { meta: rest, skip: skipEventLog === true };
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, stripControl(meta).meta),
  /**
   * An error line is also KEPT (migration 038): every `logger.error` from any
   * process lands in `system_events` as kind `error`, so an unexpected
   * failure anywhere is visible on /admin/events without anyone having added
   * a call there. The stdout line is written first and never depends on it.
   */
  error: (msg: string, err?: unknown, meta?: Record<string, unknown>) => {
    const { meta: rest, skip } = stripControl(meta);
    // Gateway and worker code pass the error as `{ err }` in meta rather than
    // as the second argument; either way it is flattened and fingerprinted.
    const thrown = err ?? (rest?.err instanceof Error ? rest.err : undefined);
    emit('error', msg, { ...serialiseError(err), ...rest });
    if (!skip) {
      const { err: _ignored, ...meta2 } = rest ?? {};
      recordEvent({
        level: 'error',
        kind: 'error',
        event: eventNameFor(msg),
        message: msg,
        code: typeof meta2.code === 'string' ? meta2.code : undefined,
        err: thrown,
        meta: meta2,
      });
    }
  },
};

/** "uncaught exception — shutting down" → "error.uncaught_exception_shutting_down". */
function eventNameFor(msg: string): string {
  const slug = msg
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 56);
  return `error.${slug || 'unnamed'}`;
}
