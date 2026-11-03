import { z } from 'zod';

/**
 * The languages a room can be in and a person can say they speak.
 *
 * This is how Dhun answers "nearby" (build-plan M20, founder 2026-11-03):
 * by LANGUAGE, never by place. No state, no city, no GPS — a distance on a
 * card is how a viewer finds a host's home, and in India a region is mostly a
 * language anyway.
 *
 * ISO 639 codes: two letters where one exists, three where it does not
 * (Bhojpuri has no two-letter code). The database checks only the SHAPE, so
 * adding a language is an edit here and to the app's list — no migration.
 */
export const LANGUAGES = [
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
] as const;

export type Language = (typeof LANGUAGES)[number];

export const languageSchema = z.enum(LANGUAGES);

/**
 * How many a person may list. Three covers nearly everyone (a mother tongue,
 * Hindi, English) and keeps the list a signal rather than "all of them".
 */
export const MAX_USER_LANGUAGES = 3;

export const userLanguagesSchema = z
  .array(languageSchema)
  .min(1)
  .max(MAX_USER_LANGUAGES)
  .refine((list) => new Set(list).size === list.length, { message: 'Languages must not repeat' });

/** When nothing better is known. Most of the launch audience is Hindi-speaking. */
export const DEFAULT_LANGUAGE: Language = 'hi';

/**
 * The language a room gets when its host did not pick one: the first they
 * listed, else the app language they use, else Hindi.
 */
export function defaultRoomLanguage(userLanguages: readonly string[], locale: string | null): Language {
  const first = userLanguages.find((code): code is Language =>
    (LANGUAGES as readonly string[]).includes(code),
  );
  if (first) return first;
  const fromLocale = locale?.split('-')[0];
  if (fromLocale && (LANGUAGES as readonly string[]).includes(fromLocale)) return fromLocale as Language;
  return DEFAULT_LANGUAGE;
}
