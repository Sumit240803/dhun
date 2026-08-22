// Per-request context, carried implicitly so nothing has to thread a trace id
// through every function signature.
//
// Day-1 non-negotiable #8: structured logging with a trace_id that runs from
// client to database. The client sends one; if it does not, we mint one. Either
// way the same id appears on every log line and in every error envelope, so a
// user can quote it and we can find their exact request.
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  traceId: string;
  userId?: string;
  path?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function traceId(): string | undefined {
  return storage.getStore()?.traceId;
}

/** Attach the authenticated user once auth has run, so later logs carry it. */
export function setContextUser(userId: string): void {
  const ctx = storage.getStore();
  if (ctx) ctx.userId = userId;
}
