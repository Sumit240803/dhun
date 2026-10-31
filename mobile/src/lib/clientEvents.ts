// A small outbound queue for the app's own reports.
//
// `reporting.ts` pushes here whatever it tells Sentry; the queue batches it
// and posts it to the API (`POST /v1/client/events`), where it lands in the
// same table as the server's errors. Pure — the sender is injected — so the
// batching rules are testable without a network.
//
// Rules, each for a reason:
//   · An error flushes within a second; everything else waits longer and
//     rides along. A crash report is time-sensitive; a warning is not.
//   · A batch that fails to send is DROPPED, never requeued. A reporter that
//     retries into an outage makes the outage worse, and a report about the
//     reporter failing would loop.
//   · The queue is bounded. Past the cap the OLDEST go — during an incident
//     the most recent report is the one that explains it.

export type ClientEventLevel = 'info' | 'warn' | 'error';

export interface ClientEvent {
  level: ClientEventLevel;
  /** A token: letters, digits, dot, dash, underscore, colon. */
  event: string;
  message?: string;
  code?: string;
  screen?: string;
  traceId?: string;
  stack?: string;
  occurredAt: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface EventQueueOptions {
  send: (events: ClientEvent[]) => Promise<void>;
  /** The server accepts at most 20. */
  maxBatch?: number;
  maxQueued?: number;
  errorFlushMs?: number;
  flushMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export interface EventQueue {
  push(event: ClientEvent): void;
  flush(): Promise<void>;
  readonly size: number;
}

const EVENT_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The server refuses anything outside its schema; shape it here so a bad report never costs a request. */
export function conformEvent(input: ClientEvent): ClientEvent | null {
  if (!EVENT_TOKEN.test(input.event)) return null;
  const clip = (value: string | undefined, max: number) =>
    value === undefined ? undefined : value.length > max ? value.slice(0, max) : value;

  let meta: ClientEvent['meta'];
  if (input.meta) {
    meta = {};
    for (const [key, value] of Object.entries(input.meta).slice(0, 20)) {
      if (key.length > 64) continue;
      if (value === null || typeof value === 'boolean') meta[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value)) meta[key] = value;
      else if (typeof value === 'string') meta[key] = clip(value, 200)!;
    }
  }

  return {
    level: input.level,
    event: input.event,
    message: clip(input.message, 500),
    code: input.code && EVENT_TOKEN.test(input.code) ? input.code : undefined,
    screen: clip(input.screen, 64),
    traceId: input.traceId && EVENT_TOKEN.test(input.traceId) ? input.traceId : undefined,
    stack: clip(input.stack, 2_000),
    occurredAt: input.occurredAt,
    meta,
  };
}

export function createEventQueue(options: EventQueueOptions): EventQueue {
  const maxBatch = Math.min(options.maxBatch ?? 20, 20);
  const maxQueued = options.maxQueued ?? 100;
  const errorFlushMs = options.errorFlushMs ?? 1_000;
  const flushMs = options.flushMs ?? 10_000;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;

  let queue: ClientEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerDueAt = Infinity;
  let sending: Promise<void> | undefined;

  const schedule = (afterMs: number) => {
    const dueAt = Date.now() + afterMs;
    if (timer && dueAt >= timerDueAt) return;
    if (timer) clearTimer(timer);
    timerDueAt = dueAt;
    timer = setTimer(() => {
      timer = undefined;
      timerDueAt = Infinity;
      void flush();
    }, afterMs);
  };

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimer(timer);
      timer = undefined;
      timerDueAt = Infinity;
    }
    if (sending) await sending;
    if (queue.length === 0) return;

    const batch = queue.slice(0, maxBatch);
    queue = queue.slice(maxBatch);

    sending = options
      .send(batch)
      .catch(() => undefined)
      .finally(() => {
        sending = undefined;
      });
    await sending;

    if (queue.length > 0) schedule(0);
  };

  return {
    push(event) {
      const shaped = conformEvent(event);
      if (!shaped) return;
      if (queue.length >= maxQueued) queue.shift();
      queue.push(shaped);
      if (queue.length >= maxBatch) schedule(0);
      else schedule(shaped.level === 'error' ? errorFlushMs : flushMs);
    },
    flush,
    get size() {
      return queue.length;
    },
  };
}
