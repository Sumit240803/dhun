// Crash and error reporting.
//
// Sentry, behind an interface, initialised only when a DSN is configured. No DSN
// means every call is a no-op — so local development is quiet and a misconfigured
// build never crashes on the reporter itself.
//
// The `trace_id` from the API's error envelope is attached to everything. That is
// what turns "a user says the app broke" into a single server log line.

import * as Sentry from '@sentry/react-native';

import { env } from '@/config/env';

const dsn = env.sentryDsn;
let initialised = false;

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
