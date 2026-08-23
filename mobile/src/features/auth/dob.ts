// Date of birth, in the one format the API accepts.
//
// The trap this exists to avoid: `date.toISOString().slice(0, 10)`.
//
// A picker returns a Date at LOCAL midnight. toISOString converts to UTC, and
// in IST (UTC+5:30) local midnight is 18:30 the PREVIOUS day — so between
// midnight and 05:30 every date sent to the server is a day early. The same
// bug, in the mirror, is what let a 17-year-old past the backend's age gate.
//
// Formatting from local calendar parts is the only version that is always right.

/** 'YYYY-MM-DD' from the picker's local calendar date. Never via toISOString. */
export function toApiDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Age in whole years today, so the screen can say why before the server does. */
export function ageInYears(dob: Date, today: Date = new Date()): number {
  const beforeBirthday =
    today.getMonth() < dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate());
  return today.getFullYear() - dob.getFullYear() - (beforeBirthday ? 1 : 0);
}

export const MIN_AGE = 18;

/**
 * The latest date of birth that still clears the gate.
 *
 * Doubles as the picker's `maximumDate`, so an underage date cannot be chosen
 * at all — a disabled range is kinder than a rejection after the fact.
 */
export function latestAdultDob(today: Date = new Date()): Date {
  return new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate());
}

/** Nobody is 100. A bounded range stops the spinner scrolling to 1900. */
export function earliestDob(today: Date = new Date()): Date {
  return new Date(today.getFullYear() - 100, 0, 1);
}

/** '12 April 1998' — long form, because a numeric date is ambiguous across locales. */
export function formatDob(date: Date, locale: string): string {
  return date.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
