// Turning a failure into something a user can act on.
//
// One place, for one reason: a screen that formats its own errors will
// eventually put a raw server string, an HTTP status or a stack trace in front
// of someone. The backend sanitises what it sends, but "sanitised" is not the
// same as "written for a user in their language".
//
// The rule: known codes get a translated sentence, everything else falls
// through to `errors.unexpected`. A trace id rides along so support can find
// the request without asking the user to describe it.

import { ApiError } from '@/api/client';
import { ApiErrorCode } from '@/api/types';
import { t, type MessageKey } from '@/i18n';

/**
 * Codes worth their own sentence.
 *
 * Deliberately NOT exhaustive. A code absent here is either impossible on the
 * client (SIGNATURE_INVALID) or already carries a specific server message that
 * the calling screen handles itself — OTP_INVALID, for instance, needs the
 * attempts-remaining count that only the OTP screen has room to show.
 */
const codeMessages: Partial<Record<string, MessageKey>> = {
  [ApiErrorCode.NETWORK_ERROR]: 'errors.network',
  [ApiErrorCode.TIMEOUT]: 'errors.timeout',
  [ApiErrorCode.RATE_LIMITED]: 'errors.rateLimited',
  [ApiErrorCode.SERVICE_UNAVAILABLE]: 'errors.serviceUnavailable',
  [ApiErrorCode.INTERNAL_ERROR]: 'errors.unexpected',
  [ApiErrorCode.ACCOUNT_BANNED]: 'errors.banned',
  [ApiErrorCode.UNAUTHENTICATED]: 'errors.sessionEnded',
  [ApiErrorCode.REFRESH_TOKEN_REUSED]: 'errors.sessionEnded',

  [ApiErrorCode.OTP_NOT_FOUND]: 'auth.otpExpired',
  [ApiErrorCode.OTP_ATTEMPTS_EXCEEDED]: 'auth.otpAttemptsExceeded',
  [ApiErrorCode.OTP_RATE_LIMITED]: 'auth.otpRateLimited',
  [ApiErrorCode.UNDERAGE]: 'auth.mustBeAdult',
  [ApiErrorCode.DOB_REQUIRED]: 'auth.dobRequired',
  [ApiErrorCode.CONTACT_UNVERIFIED]: 'email.bannerBody',
  [ApiErrorCode.INVALID_CREDENTIALS]: 'email.invalidCredentials',
  [ApiErrorCode.EMAIL_TAKEN]: 'email.taken',
  [ApiErrorCode.CODE_INVALID]: 'email.codeIncorrect',
  [ApiErrorCode.CODE_NOT_FOUND]: 'email.codeExpired',
};

/** The sentence to show. Never the raw `error.message` for an unknown code. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t('errors.unexpected');

  const key = codeMessages[error.code];
  if (key) return t(key);

  // A 4xx the server chose to explain is safe to pass through — it was written
  // for this case and is already sanitised. A 5xx never is: whatever it says
  // describes an internal failure, not something the user can do anything about.
  if (error.status < 500 && error.message) return error.message;
  return t('errors.unexpected');
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

export function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

/** Validation message for one field, when the server rejected it by name. */
export function fieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  return error.issues.find((issue) => issue.field === field)?.message;
}

/**
 * Shown under the message so support can find the request.
 *
 * Only for 5xx and unknown codes — printing a reference under "that code is not
 * correct" makes an ordinary typo look like a system failure.
 */
export function traceReference(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || !error.traceId) return undefined;
  if (error.status < 500 && codeMessages[error.code]) return undefined;
  return t('errors.reference', { traceId: error.traceId });
}
