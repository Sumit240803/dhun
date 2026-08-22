// Deep links.
//
// Not cosmetic for this product: `growth-plan-v1` makes host share links a Phase
// 0 acquisition channel — a host posts their room to a WhatsApp group, someone
// taps it, and the app must open on THAT room rather than the feed. A link that
// lands on the home screen wastes the click.
//
// Two schemes, both mapping to the same routes:
//   dhun://room/abc          the app's own scheme
//   https://dhun.live/room/abc   universal link, and the fallback for anyone
//                                without the app installed

export const SCHEME = 'dhun';
export const WEB_ORIGIN = 'https://dhun.live';

/**
 * Path templates. Kept beside the route tree so a renamed route breaks here
 * loudly, rather than producing links that silently 404 months later — long
 * after they have been shared and indexed.
 */
export const linkPaths = {
  room: (roomId: string) => `/room/${roomId}`,
  hostProfile: (hostId: string) => `/host/${hostId}`,
  /** Carries the referring host, which is what awards them the +10% points. */
  referral: (code: string) => `/join/${code}`,
  wallet: () => '/wallet',
  legal: {
    privacy: () => '/legal/privacy',
    terms: () => '/legal/terms',
    guidelines: () => '/legal/guidelines',
    grievance: () => '/legal/grievance',
  },
} as const;

/** A shareable https link — what goes into WhatsApp. */
export function webUrl(path: string): string {
  return `${WEB_ORIGIN}${path}`;
}

/** The in-app scheme URL. */
export function appUrl(path: string): string {
  return `${SCHEME}:/${path}`;
}

/**
 * The share text for a live room.
 *
 * Deliberately a whole sentence per language rather than assembled fragments —
 * Hindi word order does not survive concatenation.
 */
export function roomShareUrl(roomId: string): string {
  return webUrl(linkPaths.room(roomId));
}
