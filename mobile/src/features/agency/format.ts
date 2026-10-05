import { ApiError } from '@/api/client';
import { ApiErrorCode } from '@/api/types';

/** '12 October' — the year is noise for dates a few days away. */
export function formatDay(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'long',
  });
}

/** When a QUIT_COOLDOWN refusal says the host may apply again, if it says. */
export function cooldownUntil(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.code !== ApiErrorCode.QUIT_COOLDOWN) return undefined;
  const at = (error.details as { nextAllowedAt?: unknown } | undefined)?.nextAllowedAt;
  return typeof at === 'string' ? at : undefined;
}

/** A display name may be missing; the public id never is. */
export function personName(person: { displayName: string | null; publicId: number }): string {
  return person.displayName ?? String(person.publicId);
}
