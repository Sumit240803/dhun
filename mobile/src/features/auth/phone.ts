// Indian mobile numbers, in the two shapes the app needs.
//
// The user types ten digits. The server wants E.164. Keeping the conversion in
// one tested place means no screen ever sends '+91 98765 43210' with a space in
// it and gets a validation error it cannot explain.

export const DIAL_CODE = '+91';
const NATIONAL_LENGTH = 10;

/** Strips everything that is not a digit and caps the length. */
export function normaliseDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, NATIONAL_LENGTH);
}

/**
 * Indian mobile numbers start 6–9. Rejecting 1–5 up front turns a server round
 * trip into an instant, specific message.
 */
export function isValidNational(digits: string): boolean {
  return /^[6-9]\d{9}$/.test(digits);
}

/** E.164, which is the only form the API accepts. */
export function toE164(digits: string): string {
  return `${DIAL_CODE}${digits}`;
}

/** '98765 43210' — the grouping Indian users read a number in. */
export function formatNational(digits: string): string {
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** '+91 98765 43210', for showing back a number the user already entered. */
export function formatE164ForDisplay(e164: string): string {
  const digits = e164.startsWith(DIAL_CODE) ? e164.slice(DIAL_CODE.length) : e164;
  return `${DIAL_CODE} ${formatNational(digits)}`;
}
