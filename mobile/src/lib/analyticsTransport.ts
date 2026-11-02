// The analytics transport: the typed events from analytics.ts, batched and
// posted to `POST /v1/client/analytics` (build-plan M21 slice 5).
//
// Pure apart from the injected sender, so the shaping is tested without a
// network. Analytics is never urgent: a batch waits up to fifteen seconds or
// until fifty events, and the root layout flushes it when the app backgrounds.
//
// What the server does NOT get from here: a user id. It reads that from the
// access token, so a tampered client can claim any device but not any account.

import type { AnalyticsEvent, AnalyticsTransport } from './analytics';
import { createBatcher, type Batcher } from './batcher';

export interface AnalyticsWireEvent {
  event: string;
  occurredAt: string;
  sessionId?: string;
  props: Record<string, string | number | boolean | null>;
}

export interface AnalyticsWireBatch {
  deviceId?: string;
  events: AnalyticsWireEvent[];
}

/**
 * The common properties analytics.ts stamps on every event. They travel once
 * per batch (app block, device) or as columns (time, session), never as props.
 */
const COMMON = new Set([
  'user_id',
  'session_id',
  'device_id',
  'timestamp',
  'app_version',
  'platform',
  'country',
  'locale',
  'user_level',
  'is_paying',
]);

/** Keep what the server keeps: primitives, at most 30 keys, short strings. */
export function toWire(
  event: AnalyticsEvent,
  properties: Record<string, unknown>,
): AnalyticsWireEvent {
  const props: AnalyticsWireEvent['props'] = {};
  let kept = 0;
  for (const [key, value] of Object.entries(properties)) {
    if (COMMON.has(key) || key.length > 64 || kept >= 30) continue;
    if (value === null || typeof value === 'boolean') props[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) props[key] = value;
    else if (typeof value === 'string') props[key] = value.slice(0, 200);
    else continue;
    kept++;
  }
  // Locale and level are worth keeping per event; they change mid-session.
  if (typeof properties.locale === 'string') props.locale = properties.locale;
  if (typeof properties.user_level === 'number') props.user_level = properties.user_level;

  return {
    event,
    occurredAt:
      typeof properties.timestamp === 'string' ? properties.timestamp : new Date().toISOString(),
    sessionId:
      typeof properties.session_id === 'string' && properties.session_id
        ? properties.session_id
        : undefined,
    props,
  };
}

export function createHttpAnalyticsTransport(options: {
  send: (batch: AnalyticsWireBatch) => Promise<void>;
  deviceId: () => string | undefined;
  flushMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): AnalyticsTransport & { flush(): Promise<void>; readonly size: number } {
  const batcher: Batcher<AnalyticsWireEvent> = createBatcher({
    send: (events) => options.send({ deviceId: options.deviceId(), events }),
    maxBatch: 50,
    maxQueued: 500,
    flushMs: options.flushMs ?? 15_000,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });

  return {
    track(event, properties) {
      batcher.push(toWire(event, properties));
    },
    flush: () => batcher.flush(),
    get size() {
      return batcher.size;
    },
  };
}
