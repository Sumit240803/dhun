// Every piece of room art that does not exist yet, named in one place.
//
// ── Why a registry rather than a TODO in each component ──────────────────────
//
// The room is built against `docs/asset-contract.md`, which says art is never
// bundled: the catalog stores a path, the client resolves it against the CDN,
// and swapping art is an upload. Nothing in the room should therefore import an
// image — it should resolve a PATH.
//
// Until those files are drawn, each component falls back to a code-drawn stand
// in. That is fine, and it is also exactly how a placeholder quietly becomes
// permanent: it looks finished, nobody is reminded, and the brief never gets
// written.
//
// So the paths live here, with their specs, `available: false` beside each one,
// and `roomAssetPath()` returning null until the flag flips. One grep for
// `available: false` is the outstanding art order for the room, and turning one
// on is a one-line change once the file is on the CDN.
//
// Specs below are binding — they belong in the art brief verbatim. See §8 of
// the asset contract for backdrops, which are the one entry already shipped.

export interface RoomAsset {
  /** Path under the asset base, versioned and immutable. */
  path: string;
  /** Flip to true once the file is on the CDN. */
  available: boolean;
  /** Goes in the brief. */
  spec: string;
}

export const ROOM_ASSETS = {
  /**
   * The empty chair in a party room.
   *
   * The references draw a small sofa or throne per empty seat, numbered, which
   * is what makes an empty room look like a venue rather than a bug. Drawn in
   * code as a dashed ring until this exists.
   */
  seatPlaceholder: {
    path: 'rooms/seats/placeholder.v1.webp',
    available: false,
    spec:
      '192×192 WebP, transparent, ≤12 KB. A seat seen three-quarter on, ' +
      'empty. Must read at 38pt as well as 72pt — no interior detail. One ' +
      'neutral tint; the app does not recolour it.',
  },

  /**
   * The host's chair, for seat 0.
   *
   * Larger and crowned in the references, so the host reads as the host before
   * you have read a single name.
   */
  hostSeatPlaceholder: {
    path: 'rooms/seats/host.v1.webp',
    available: false,
    spec:
      '192×192 WebP, transparent, ≤14 KB. The same chair as ' +
      'seatPlaceholder, crowned. Same silhouette so the grid stays a family.',
  },

  /**
   * The marker that rides the PK boundary.
   *
   * A tug-of-war flag: it sits where the two scores meet and slides as gifts
   * land. Animated chevrons are drawn in code until this exists, and honestly
   * they are enough for v1.
   */
  pkBoundary: {
    path: 'rooms/pk/boundary.v1.json',
    available: false,
    spec:
      'Lottie, 240×240, transparent, ≤120 KB, LOOPING (it is on screen for ' +
      'the whole battle). No text layers. Reads at 40pt tall. See §3 of the ' +
      'asset contract for the Lottie restrictions — all of them apply.',
  },

  /** The starburst behind the PK clock. Static, tiny. */
  pkBadge: {
    path: 'rooms/pk/badge.v1.webp',
    available: false,
    spec:
      '96×96 WebP, transparent, ≤8 KB. A starburst carrying the letters ' + 'PK. Legible at 24pt.',
  },

  /**
   * The chest in the free-coin popup.
   *
   * The one asset here that code genuinely cannot fake — a gold chest with a
   * glow is a picture, not a gradient.
   */
  freeCoinChest: {
    path: 'rooms/rewards/chest.v1.webp',
    available: false,
    spec:
      '512×512 WebP, transparent, ≤60 KB. An OPEN treasure chest overflowing ' +
      'with gold coins, a few coins in flight and the light burst baked in. ' +
      'Stylized 3D (C4D look), lit from the upper left to match the gift icons. ' +
      'Also heads the new-user rewards sheet.',
  },
  /**
   * The icon beside "More ways to earn coins" on the new-user sheet.
   *
   * NO question mark on it. A "?" box is loot-box iconography, and a reward
   * surface that looks like a mystery box invites exactly the reading hard
   * rule #1 exists to keep away from this app.
   */
  rewardGiftBox: {
    path: 'rooms/rewards/gift-box.v1.webp',
    available: false,
    spec:
      '192×192 WebP, transparent, ≤20 KB. A wrapped gift box with a ribbon, ' +
      'same 3D style as the chest. No question mark, no lock, nothing hidden.',
  },
} as const satisfies Record<string, RoomAsset>;

export type RoomAssetId = keyof typeof ROOM_ASSETS;

/**
 * The path for a room asset, or null while it is still unavailable.
 *
 * Null is the signal to draw the code fallback. Callers must handle it — there
 * is no fallback path, because a path that 404s is a broken image in a live
 * room and a dashed ring is not.
 */
export function roomAssetPath(id: RoomAssetId): string | null {
  const asset = ROOM_ASSETS[id];
  return asset.available ? asset.path : null;
}

/** Everything still to be drawn. Used by a test, so the list cannot rot. */
export function pendingRoomAssets(): RoomAssetId[] {
  return (Object.keys(ROOM_ASSETS) as RoomAssetId[]).filter((id) => !ROOM_ASSETS[id].available);
}
