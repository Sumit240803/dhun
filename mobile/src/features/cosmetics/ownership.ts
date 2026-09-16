// What the store shows for an item, given what the user already holds.

import type { Cosmetic, OwnedCosmetic, UserLook } from '@/api/types';
import { daysLeft } from '@/visuals/look';

export type ItemStatus =
  /** Never bought. */
  | { kind: 'available' }
  /** Owned, active, and on. */
  | { kind: 'wearing'; daysLeft: number }
  /** Owned and active, but something else of its kind is on. */
  | { kind: 'owned'; daysLeft: number }
  /** Owned once; its time has run out. */
  | { kind: 'expired' };

export function itemStatus(
  cosmeticId: string,
  owned: readonly OwnedCosmetic[],
  now: number = Date.now(),
): ItemStatus {
  const item = owned.find((candidate) => candidate.cosmeticId === cosmeticId);
  if (!item) return { kind: 'available' };

  // The server's `active` is a snapshot from when the list was fetched. The
  // clock is re-checked here, so a store left open for hours does not offer
  // to wear something that lapsed while it sat there.
  const left = daysLeft(item.expiresAt, now);
  if (!item.active || left === 0) return { kind: 'expired' };
  return item.equipped ? { kind: 'wearing', daysLeft: left } : { kind: 'owned', daysLeft: left };
}

/**
 * The user as they would look wearing this item, over what they wear now.
 *
 * The preview is the whole sales pitch of a cosmetic: nobody buys a frame from
 * a thumbnail of the frame alone, they buy it from seeing their own face in it.
 */
export function previewLook(current: UserLook, item: Cosmetic): UserLook {
  switch (item.kind) {
    case 'frame':
      return { ...current, frame: { asset: item.asset, style: item.style } };
    case 'chat_bubble':
      return { ...current, bubble: item.style };
    case 'nickname_color':
      return { ...current, nameColor: item.style };
    case 'entry_effect':
      return { ...current, entry: { asset: item.asset, style: item.style } };
  }
}

/** Gems received for converting coins — the server's own floor arithmetic. */
export function gemsForCoins(coins: number, rateBp: number): number {
  return Math.floor((coins * rateBp) / 10_000);
}
