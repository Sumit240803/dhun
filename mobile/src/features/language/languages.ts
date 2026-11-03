// The languages a room can be in, and the rules for choosing them.
//
// "Nearby" in Dhun means LANGUAGE and nothing else (build-plan M20, founder
// 2026-11-03). No state, no city, no location permission — ever. A distance on
// a card is how a viewer finds where a host lives.
//
// Mirrors backend/src/shared/languages.ts. The server is the authority — it
// refuses a code it does not know — so a language added there and not here is
// simply not offered yet, never broken.

import type { LocaleCode, MessageKey } from '@/i18n';
import type { Language } from '@/api/types';

/** In the order the picker offers them: the launch audience's first. */
export const LANGUAGES: readonly Language[] = [
  'hi',
  'en',
  'bho',
  'bn',
  'mr',
  'ta',
  'te',
  'kn',
  'ml',
  'gu',
  'pa',
  'or',
  'as',
  'ur',
];

/** Same as the server's. Three covers a mother tongue, Hindi and English. */
export const MAX_LANGUAGES = 3;

export const LANGUAGE_LABELS: Record<Language, MessageKey> = {
  hi: 'language.hi',
  en: 'language.en',
  bho: 'language.bho',
  bn: 'language.bn',
  mr: 'language.mr',
  ta: 'language.ta',
  te: 'language.te',
  kn: 'language.kn',
  ml: 'language.ml',
  gu: 'language.gu',
  pa: 'language.pa',
  or: 'language.or',
  as: 'language.as',
  ur: 'language.ur',
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** The language a person most likely speaks, before they have said: their app language. */
export function languageFromLocale(locale: LocaleCode): Language {
  return locale === 'en' ? 'en' : 'hi';
}

/**
 * Splits the list for the picker: the person's own languages first, in their
 * order, then the rest in the standard order. Unknown codes are dropped, so a
 * stale session can never put a blank chip on screen.
 */
export function pickerSections(own: readonly string[]): { yours: Language[]; more: Language[] } {
  const yours = own.filter(isLanguage).filter((code, index, list) => list.indexOf(code) === index);
  return { yours, more: LANGUAGES.filter((code) => !yours.includes(code)) };
}

/**
 * Taps a language in a multi-select. Removing always works; adding past the
 * limit is refused and says so, rather than silently dropping the oldest —
 * a choice the person did not make.
 */
export function toggleLanguage(
  list: readonly Language[],
  code: Language,
): { next: Language[]; refused: boolean } {
  if (list.includes(code)) return { next: list.filter((item) => item !== code), refused: false };
  if (list.length >= MAX_LANGUAGES) return { next: [...list], refused: true };
  return { next: [...list, code], refused: false };
}
