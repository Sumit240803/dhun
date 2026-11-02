// Analytics.
//
// The event names below are the CLIENT HALF of the taxonomy in
// `documents/data-and-launch-plan-v1.pdf`. That doc's central warning is that
// changing an event schema later is painful — old data does not fit the new
// shape and you lose your history. So the names are locked here as a typed
// union: a typo is a compile error, and a renamed event has to be renamed
// deliberately.
//
// Common properties (user_id, session_id, device_id, app_version, platform,
// locale, user_level, is_paying) attach automatically. The doc is explicit about
// why: attached by hand, roughly a fifth of events end up missing them.

import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { telemetryApi } from '@/api/endpoints/telemetry';

import { env } from '@/config/env';
import { getLocale } from '@/i18n';
import { createHttpAnalyticsTransport } from './analyticsTransport';
import { addBreadcrumb } from './reporting';

/** `object_action`, past tense — the convention from the data plan. */
export type AnalyticsEvent =
  // session
  | 'app_opened'
  | 'app_backgrounded'
  | 'session_ended'
  // auth
  | 'signup_started'
  | 'otp_sent'
  | 'otp_verified'
  | 'signup_completed'
  | 'login_completed'
  // discovery
  | 'feed_viewed'
  | 'room_card_impressed'
  | 'room_card_tapped'
  | 'host_followed'
  | 'host_unfollowed'
  | 'search_performed'
  | 'category_selected'
  // room
  | 'room_joined'
  | 'room_left'
  | 'room_watch_heartbeat'
  | 'mic_requested'
  | 'mic_granted'
  // engagement
  | 'message_sent'
  | 'emoji_sent'
  | 'host_followed'
  | 'host_unfollowed'
  | 'stream_shared'
  // economy
  | 'coin_pack_viewed'
  | 'purchase_initiated'
  | 'purchase_completed'
  | 'purchase_failed'
  | 'gift_sent'
  | 'cosmetic_purchased'
  | 'vip_purchased'
  | 'super_message_sent'
  | 'coins_converted'
  | 'free_coins_earned'
  | 'verification_submitted'
  | 'appeal_filed'
  // host
  | 'go_live_started'
  | 'go_live_ended'
  | 'withdrawal_requested'
  // safety
  | 'user_reported'
  | 'user_blocked'
  // lifecycle
  | 'push_received'
  | 'push_opened'
  | 'notification_permission_granted';

export interface AnalyticsTransport {
  track(event: AnalyticsEvent, properties: Record<string, unknown>): void;
}

/**
 * Development transport: prints the event. Replaced at launch by
 * startHttpAnalytics(), which posts to POST /v1/client/analytics (and still
 * prints in development).
 */
class ConsoleTransport implements AnalyticsTransport {
  track(event: AnalyticsEvent, properties: Record<string, unknown>) {
    if (__DEV__) console.log(`[analytics] ${event}`, properties);
  }
}

let transport: AnalyticsTransport = new ConsoleTransport();

export function setAnalyticsTransport(next: AnalyticsTransport): void {
  transport = next;
}

// Session-scoped context, set once at sign-in and reused on every event.
let context: {
  userId?: string;
  sessionId: string;
  deviceId?: string;
  userLevel?: number;
  isPaying?: boolean;
} = { sessionId: '' };

export function startAnalyticsSession(sessionId: string, deviceId?: string): void {
  context = { ...context, sessionId, deviceId };
}

export function setAnalyticsUser(user: {
  userId?: string;
  userLevel?: number;
  isPaying?: boolean;
}): void {
  context = { ...context, ...user };
}

export function track(event: AnalyticsEvent, properties: Record<string, unknown> = {}): void {
  transport.track(event, {
    ...properties,
    user_id: context.userId,
    session_id: context.sessionId,
    device_id: context.deviceId,
    timestamp: new Date().toISOString(),
    app_version: env.appVersion,
    platform: Platform.OS,
    country: 'IN',
    locale: getLocale(),
    user_level: context.userLevel,
    is_paying: context.isPaying,
  });

  // Doubles as a crash breadcrumb — knowing the last five actions before a crash
  // is usually more useful than the stack trace.
  addBreadcrumb(`analytics:${event}`, properties);
}

// ── Shipping (build-plan M21 slice 5) ─────────────────────────────────────────

let http: ReturnType<typeof createHttpAnalyticsTransport> | null = null;

/**
 * Start posting events to the API. Called once, at module load of the root
 * layout. Batches of up to fifty, every fifteen seconds; a failed batch is
 * dropped, never retried (lib/batcher.ts).
 */
export function startHttpAnalytics(): void {
  if (http) return;
  const printer = new ConsoleTransport();
  http = createHttpAnalyticsTransport({
    deviceId: () => context.deviceId,
    send: async (batch) => {
      await telemetryApi.analytics({
        ...batch,
        app: {
          version: env.appVersion,
          platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android',
          ...runningBundle(),
        },
      });
    },
  });
  const shipping = http;
  setAnalyticsTransport({
    track(event, properties) {
      printer.track(event, properties);
      shipping.track(event, properties);
    },
  });
}

/** Send what is queued now — on the way to the background. */
export function flushAnalytics(): Promise<void> {
  return http?.flush() ?? Promise.resolve();
}

function runningBundle(): { update?: string } {
  if (!Updates.isEnabled) return { update: 'development' };
  return { update: Updates.isEmbeddedLaunch ? 'embedded' : (Updates.updateId ?? undefined) };
}
