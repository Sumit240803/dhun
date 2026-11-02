// A small outbound queue for the app's own reports.
//
// `reporting.ts` pushes here whatever it tells Sentry; the queue batches it
// and posts it to the API (`POST /v1/client/events`), where it lands in the
// same table as the server's errors. Pure — the sender is injected — so the
// batching rules are testable without a network.
//
// The batching rules live in batcher.ts and are shared with analytics. What
// is specific here: an error is urgent (sent within a second, a crash report
// is time-sensitive), and every report is shaped to the server's schema first,
// so a bad one never costs a request.

import { createBatcher } from './batcher';

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
  const batcher = createBatcher<ClientEvent>({
    send: options.send,
    // The server accepts at most 20 a batch.
    maxBatch: Math.min(options.maxBatch ?? 20, 20),
    maxQueued: options.maxQueued ?? 100,
    flushMs: options.flushMs ?? 10_000,
    urgentMs: options.errorFlushMs ?? 1_000,
    isUrgent: (event) => event.level === 'error',
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });

  return {
    push(event) {
      const shaped = conformEvent(event);
      if (shaped) batcher.push(shaped);
    },
    flush: () => batcher.flush(),
    get size() {
      return batcher.size;
    },
  };
}
