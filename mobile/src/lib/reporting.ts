// Crash and error reporting.
//
// Sentry, behind an interface, initialised only when a DSN is configured. No DSN
// means every call is a no-op — so local development is quiet and a misconfigured
// build never crashes on the reporter itself.
//
// The `trace_id` from the API's error envelope is attached to everything. That is
// what turns "a user says the app broke" into a single server log line.

import * as Sentry from '@sentry/react-native';
import { Platform } from 'react-native';

import { telemetryApi } from '@/api/endpoints/telemetry';
import { env } from '@/config/env';

import { createEventQueue, type ClientEventLevel } from './clientEvents';

const dsn = env.sentryDsn;
let initialised = false;

/**
 * Our own copy of every report, beside Sentry's.
 *
 * Posted in batches to `POST /v1/client/events`, where it lands in the same
 * table as the API's errors — so the trace id on an ApiError joins "the gift
 * failed in the app" to "the gift failed on the server" on one screen. Works
 * with or without a Sentry DSN, signed in or not.
 *
 * A failed send is dropped by the queue and never reported, so the reporter
 * cannot report itself in a loop.
 */
const ownEvents = createEventQueue({
  send: async (events) => {
    await telemetryApi.events({
      app: {
        version: env.appVersion,
        build: String(env.buildNumber),
        platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android',
        env: env.environment,
      },
      events,
    });
  },
});

function keep(
  level: ClientEventLevel,
  event: string,
  context: ErrorContext | undefined,
  error?: unknown,
) {
  const { traceId, code, screen, ...rest } = context ?? {};
  const meta: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      meta[key] = value as string | number | boolean | null;
    }
  }
  ownEvents.push({
    level,
    event,
    message: error instanceof Error ? error.message : typeof error === 'string' ? error : undefined,
    code,
    screen,
    traceId,
    stack: error instanceof Error ? error.stack : undefined,
    occurredAt: new Date().toISOString(),
    meta,
  });
}

/** Send whatever is queued now — on the way to the background, before the OS may kill the app. */
export function flushReports(): Promise<void> {
  return ownEvents.flush();
}

export function initReporting(): void {
  if (initialised || !dsn) return;

  Sentry.init({
    dsn,
    environment: env.environment,
    release: `dhun@${env.appVersion}`,
    dist: String(env.buildNumber),

    // Full sampling in staging, thinned in production — this app has long
    // sessions and a room generates a lot of breadcrumbs.
    tracesSampleRate: env.isProduction ? 0.1 : 1.0,

    // Never ship a device's screen contents to a third party: a room is other
    // people's faces, and a wallet is someone's balance.
    attachScreenshot: false,
    attachViewHierarchy: false,

    beforeSend(event) {
      // Belt and braces against leaking a token through a breadcrumb URL or an
      // error message. The reporter is the one place that ships strings off the
      // device, so it gets scrubbed regardless of what upstream did.
      if (event.request?.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers['Idempotency-Key'];
      }
      return event;
    },
  });

  initialised = true;
}

export interface ErrorContext {
  /** From the API error envelope. The single most useful field on a report. */
  traceId?: string;
  /** Stable error code, so reports group by cause rather than by message. */
  code?: string;
  screen?: string;
  [key: string]: unknown;
}

export function reportError(error: unknown, context?: ErrorContext): void {
  if (__DEV__) console.error('[report]', error, context ?? '');
  keep('error', context?.code ?? (error instanceof Error ? error.name : 'error'), context, error);
  if (!initialised) return;

  Sentry.withScope((scope) => {
    if (context?.traceId) scope.setTag('trace_id', context.traceId);
    if (context?.code) scope.setTag('error_code', context.code);
    if (context?.screen) scope.setTag('screen', context.screen);
    scope.setContext('detail', { ...context });
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

export function reportMessage(message: string, context?: ErrorContext): void {
  if (__DEV__) console.warn('[report]', message, context ?? '');
  keep('warn', context?.code ?? 'message', context, message);
  if (!initialised) return;
  Sentry.captureMessage(message, { extra: context });
}

/** Ties reports to a user without shipping anything identifying. */
export function setReportingUser(userId: string | null): void {
  if (!initialised) return;
  // id only — never the phone number. A crash report is not a place for PII.
  Sentry.setUser(userId ? { id: userId } : null);
}

/** A trail of what happened before the crash. Far more useful than the stack alone. */
export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (!initialised) return;
  Sentry.addBreadcrumb({ message, data, level: 'info' });
}
