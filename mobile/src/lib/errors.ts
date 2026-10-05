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
  [ApiErrorCode.PASSWORD_TOO_SHORT]: 'email.passwordTooShort',
  [ApiErrorCode.NO_PASSWORD]: 'account.noPassword',
  [ApiErrorCode.PHONE_TAKEN]: 'account.phoneTaken',
  [ApiErrorCode.PHONE_UNCHANGED]: 'account.phoneUnchanged',

  // Unmapped, this fell through to the SERVER's sentence — "Verify your phone
  // number to continue" — which is wrong twice over: email registration works
  // too, and an unmapped code also prints a support reference, so an ordinary
  // "you need an account" read as a system failure.
  [ApiErrorCode.REGISTRATION_REQUIRED]: 'room.registrationRequired',

  [ApiErrorCode.ROOM_ENDED]: 'room.ended',
  [ApiErrorCode.ROOM_BANNED]: 'room.kicked',
  [ApiErrorCode.SEAT_TAKEN]: 'room.seatTaken',
  [ApiErrorCode.SEAT_RESERVED]: 'room.seatReserved',
  [ApiErrorCode.ALREADY_SEATED]: 'room.alreadySeated',
  // A media-server outage, not the user getting anything wrong. Same sentence
  // as any other service being briefly unavailable.
  [ApiErrorCode.RTC_UNAVAILABLE]: 'errors.serviceUnavailable',

  // INSUFFICIENT_BALANCE is deliberately absent: conversion returns it too, and
  // "not enough coins for this gift" would be wrong there. The gift sheet says
  // it in its own words.
  [ApiErrorCode.GIFT_PRICE_CHANGED]: 'gifting.priceChanged',
  [ApiErrorCode.COSMETIC_PRICE_CHANGED]: 'cosmeticErrors.priceChanged',
  [ApiErrorCode.WELCOME_ALREADY_USED_ON_DEVICE]: 'rewardErrors.welcomeUsedOnDevice',
  [ApiErrorCode.REWARD_UNAVAILABLE]: 'rewardErrors.unavailable',
  [ApiErrorCode.REFERRAL_SELF]: 'rewardErrors.referralSelf',
  [ApiErrorCode.REFERRAL_ALREADY_SET]: 'rewardErrors.referralAlreadySet',
  [ApiErrorCode.REFERRAL_WINDOW_CLOSED]: 'rewardErrors.referralWindowClosed',
  [ApiErrorCode.REFERRAL_NOT_ALLOWED]: 'rewardErrors.referralNotAllowed',
  [ApiErrorCode.REFERRAL_CODE_INVALID]: 'rewards.codeInvalid',
  [ApiErrorCode.COSMETIC_NOT_FOUND]: 'cosmeticErrors.unavailable',
  [ApiErrorCode.COSMETIC_NOT_OWNED]: 'cosmeticErrors.notOwned',
  [ApiErrorCode.COSMETIC_EXPIRED]: 'cosmeticErrors.expired',
  [ApiErrorCode.GIFT_NOT_FOUND]: 'gifting.giftUnavailable',
  [ApiErrorCode.RECIPIENT_NOT_IN_ROOM]: 'gifting.recipientGone',

  [ApiErrorCode.ALREADY_IN_AGENCY]: 'agencyErrors.alreadyInAgency',
  [ApiErrorCode.AGENT_NOT_FOUND]: 'agencyErrors.agentNotFound',
  [ApiErrorCode.CANNOT_JOIN_SELF]: 'agencyErrors.cannotJoinSelf',
  [ApiErrorCode.REQUEST_ALREADY_PENDING]: 'agencyErrors.alreadyPending',
  [ApiErrorCode.INVITE_NOT_MATCHED]: 'agencyErrors.inviteNotMatched',
  [ApiErrorCode.HOST_IN_AGENCY]: 'agencyErrors.hostInAgency',
  [ApiErrorCode.NOT_AN_AGENT]: 'agencyErrors.notAnAgent',
  [ApiErrorCode.REQUEST_NOT_FOUND]: 'agencyErrors.requestClosed',
  [ApiErrorCode.REQUEST_CLOSED]: 'agencyErrors.requestClosed',
  [ApiErrorCode.AGENCY_UNAVAILABLE]: 'agencyErrors.agencyUnavailable',
  [ApiErrorCode.NOT_IN_AGENCY]: 'agencyErrors.notInAgency',
  [ApiErrorCode.QUIT_ALREADY_PENDING]: 'agencyErrors.quitPending',
  // The quit sheet names the date from details.nextAllowedAt itself; this is
  // the fallback for anywhere else.
  [ApiErrorCode.QUIT_COOLDOWN]: 'agencyErrors.quitCooldown',
  [ApiErrorCode.NOT_AGENCY_OWNER]: 'agencyErrors.notOwner',
  [ApiErrorCode.QUIT_DECISION_CLOSED]: 'agencyErrors.decisionClosed',
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

/**
 * Whether a failed money request might nonetheless have gone through.
 *
 * A 4xx is the server saying no, and nothing moved. No response at all, a
 * timeout, a 5xx or a still-in-flight 409 all leave the question open — and
 * the retry of such a request must reuse its idempotency key, or it may charge
 * twice. Shared by every screen that spends: gifts, cosmetics, conversion.
 */
export function outcomeUnknown(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.code === ApiErrorCode.NETWORK_ERROR || error.code === ApiErrorCode.TIMEOUT) return true;
  if (error.code === ApiErrorCode.REQUEST_IN_PROGRESS) return true;
  return error.status >= 500;
}
