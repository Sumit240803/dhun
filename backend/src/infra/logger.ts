// Structured logging. One JSON object per line, so ClickHouse and CloudWatch can
// both parse it without a regex.
//
// trace_id is pulled from the async context rather than passed in, which means
// no call site can forget it.
import { currentContext } from './context.js';

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

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, err?: unknown, meta?: Record<string, unknown>) =>
    emit('error', msg, { ...serialiseError(err), ...meta }),
};
