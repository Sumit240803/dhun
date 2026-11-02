// When an over-the-air update may replace the running JavaScript.
//
// Pure, so the rule is tested without expo-updates. The rule, in one line:
// only when the person would not notice — after a long absence, and never
// while a room is playing.
//
// expo-updates already downloads on every cold start and applies on the NEXT
// cold start. Phones in India are rarely cold-started (the app lives in the
// background for days), so without this a fix could take a week to land. With
// it, a fix lands the next time someone comes back after half an hour, which
// is indistinguishable from a cold start to them.
//
// Never in a room — open or minimised. A reload drops the LiveKit connection
// and the gateway socket; mid-room that is the host's audience vanishing.

/** Half an hour in the background makes a reload feel like a fresh launch. */
export const MIN_AWAY_MS = 30 * 60_000;

export interface OtaMoment {
  /** How long the app was in the background before this return. */
  awayMs: number;
  /** A room screen is open, or a room is minimised into the floating player. */
  inRoom: boolean;
}

/** Is coming back to the foreground a moment to check for an update? */
export function shouldCheck(moment: OtaMoment): boolean {
  return moment.awayMs >= MIN_AWAY_MS && !moment.inRoom;
}

/** An update was fetched: may it be applied now, by reloading? */
export function shouldApply(moment: OtaMoment & { fetched: boolean }): boolean {
  return moment.fetched && shouldCheck(moment);
}
