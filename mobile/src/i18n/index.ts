// Localisation.
//
// Hand-rolled rather than a library, for one reason: TYPED KEYS. `t('auth.otpTitle')`
// autocompletes and a typo is a compile error. With i18n-js or similar, keys are
// strings and a missing one is a blank label found in QA — or worse, in production
// in a language nobody on the team reads.
//
// India-first with a regional-language bet means every untranslated string is
// debt. Adding this after forty screens is a week of mechanical edits, which is
// why it exists before the first screen.

import { getLocales } from 'expo-localization';
import { useCallback, useSyncExternalStore } from 'react';

import { en, type Messages } from './en';
import { hi } from './hi';

export type LocaleCode = 'en' | 'hi';

const catalogues: Record<LocaleCode, Messages> = { en, hi };

/**
 * Every valid message path, as a union of dotted strings.
 *
 *   'common.retry' | 'auth.otpTitle' | ...
 */
type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;

function detectLocale(): LocaleCode {
  const preferred = getLocales()[0]?.languageCode;
  return preferred === 'hi' ? 'hi' : 'en';
}

let current: LocaleCode = detectLocale();
const listeners = new Set<() => void>();

function resolve(catalogue: Messages, key: string): string | undefined {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalogue);
  return typeof value === 'string' ? value : undefined;
}

/** Replaces {placeholders}. Missing values are left visible rather than silently blank. */
function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in values ? String(values[name]) : match,
  );
}

/**
 * Translate.
 *
 * Falls back to English when a Hindi string is missing, and to the key itself if
 * even English lacks it — a visible `auth.otpTitle` on screen is a bug report
 * that writes itself, where an empty label is not.
 */
export function t(key: MessageKey, values?: Record<string, string | number>): string {
  return translateIn(current, key, values);
}

/** The pure form. Takes the locale rather than reading module state. */
function translateIn(
  locale: LocaleCode,
  key: MessageKey,
  values?: Record<string, string | number>,
): string {
  const message = resolve(catalogues[locale], key) ?? resolve(en, key) ?? key;
  return interpolate(message, values);
}

/**
 * Plural helper. English and Hindi both split one/other, so this covers both;
 * a language with dual or paucal forms would need the key set extended.
 */
export function tPlural(
  singular: MessageKey,
  plural: MessageKey,
  count: number,
  values?: Record<string, string | number>,
): string {
  return t(count === 1 ? singular : plural, { count, ...values });
}

export function getLocale(): LocaleCode {
  return current;
}

export function setLocale(next: LocaleCode): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Re-renders the component when the locale changes.
 *
 * `t` is REBUILT when the locale changes, so its identity changes with it.
 * That is load-bearing, not tidiness: React Compiler is enabled, and a call
 * like `t('me.language')` has a stable callee and a literal argument, so the
 * compiler memoises the resulting string and never recomputes it. The first
 * version returned the module-level `t` and discarded this hook's value — so
 * switching language re-rendered every screen and every string on them stayed
 * exactly as it was. Hindi only appeared once a screen happened to remount.
 *
 * The rule this encodes: anything whose RESULT depends on external state must
 * change identity when that state does, or the compiler is right to cache it.
 */
export function useTranslation() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);

  const translate = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) => translateIn(locale, key, values),
    [locale],
  );

  const translatePlural = useCallback(
    (
      singular: MessageKey,
      plural: MessageKey,
      count: number,
      values?: Record<string, string | number>,
    ) => translate(count === 1 ? singular : plural, { count, ...values }),
    [translate],
  );

  return { t: translate, tPlural: translatePlural, locale, setLocale };
}

export { en };
export type { Messages };
