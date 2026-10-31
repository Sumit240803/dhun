// The spending-limits form, as pure functions so they can be tested without
// a screen: what the fields show, what the server receives, and whether a
// draft is worth sending at all.

import type { SpendExclusion, SpendStatus } from '@/api/types';

export interface SpendDraft {
  /** Digits only, or '' for "no limit". */
  daily: string;
  monthly: string;
  /** null = leave the running pause as it is; the server gets no exclusion. */
  exclusion: SpendExclusion | null;
}

export const MIN_CAP_COINS = 100;

export function draftFrom(status: SpendStatus): SpendDraft {
  return {
    daily: status.dailyCapCoins === null ? '' : String(status.dailyCapCoins),
    monthly: status.monthlyCapCoins === null ? '' : String(status.monthlyCapCoins),
    exclusion: status.excludedPermanently ? 'permanent' : status.excluded ? null : 'none',
  };
}

/** '' → null; anything else → the integer, or NaN when it is not one. */
export function parseCap(text: string): number | null {
  const trimmed = text.replace(/[,\s]/g, '');
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

export type CapIssue = 'notANumber' | 'tooSmall' | 'dailyAboveMonthly';

/** Field-level problems, keyed by field. Empty when the draft can be sent. */
export function capIssues(draft: SpendDraft): Partial<Record<'daily' | 'monthly', CapIssue>> {
  const issues: Partial<Record<'daily' | 'monthly', CapIssue>> = {};
  const daily = parseCap(draft.daily);
  const monthly = parseCap(draft.monthly);
  if (daily !== null && Number.isNaN(daily)) issues.daily = 'notANumber';
  else if (daily !== null && daily < MIN_CAP_COINS) issues.daily = 'tooSmall';
  if (monthly !== null && Number.isNaN(monthly)) issues.monthly = 'notANumber';
  else if (monthly !== null && monthly < MIN_CAP_COINS) issues.monthly = 'tooSmall';
  if (!issues.daily && !issues.monthly && daily !== null && monthly !== null && daily > monthly) {
    issues.daily = 'dailyAboveMonthly';
  }
  return issues;
}

/**
 * Whether a cap is being RAISED — which the server applies only after its
 * delay. Shown before saving, so the delay is never a surprise afterwards.
 */
export function raisesCap(current: number | null, next: number | null): boolean {
  const from = current ?? Number.POSITIVE_INFINITY;
  const to = next ?? Number.POSITIVE_INFINITY;
  return to > from;
}
