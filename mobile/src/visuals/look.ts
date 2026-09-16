// Turning server style data into what this app draws.
//
// Cosmetic styles arrive with BOTH palettes, because a colour chosen for a
// light background is often unreadable on a dark one. The app draws whichever
// palette `MODE` names — the same switch every other colour in the app follows.

import type { Themed, UserLook } from '@/api/types';
import { MODE } from '@/theme';

export function themed<T>(style: Themed<T>): T {
  return style[MODE];
}

/**
 * The variant to draw over MEDIA — a stage, a scrim, video. Always the dark
 * one: those surfaces are dark in both app palettes, and a light-mode name
 * colour chosen for a white background disappears on them.
 */
export function onMedia<T>(style: Themed<T>): T {
  return style.dark;
}

/** The frame parts an Avatar takes, or nothing to draw. */
export function frameOf(frame: UserLook['frame'] | undefined): {
  asset: string | null;
  ring: string;
} | null {
  if (!frame) return null;
  return { asset: frame.asset, ring: themed(frame.style).ring };
}

/**
 * Whole days of wear left, rounded UP — an item with six hours left still has
 * "1 day", never "0 days", which would read as already gone.
 */
export function daysLeft(expiresAt: string, now: number = Date.now()): number {
  const ms = new Date(expiresAt).getTime() - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
