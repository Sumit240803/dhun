// What a worn cosmetic looks like, as data — and the check that it is sane.
//
// Styles are written by hand into the catalog by whoever adds an item, and they
// reach every client that renders the person wearing it. A typo'd colour must
// not crash a room, and a string where a colour belongs must not reach a style
// prop. So every style is parsed here on the way OUT; anything that fails is
// dropped and logged, and the item simply draws nothing rather than drawing
// garbage.
//
// Shared rather than owned by one module: the catalog (economy) and the looks
// attached to seats, chat and gifts (cosmetics) both need the same answer.
// See docs/asset-contract.md § 6.

import { z } from 'zod';

/** #RRGGBB only. No names, no alpha, no rgb() — one format a client can trust. */
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

function themed<T extends z.ZodTypeAny>(variant: T) {
  return z.object({ light: variant, dark: variant }).strict();
}

export const COSMETIC_STYLE_SCHEMAS = {
  nickname_color: themed(z.object({ color: hex }).strict()),
  chat_bubble: themed(z.object({ background: hex, border: hex, text: hex }).strict()),
  // The ring is the frame drawn in code — shown while the art loads, and
  // instead of it when the art cannot load at all.
  frame: themed(z.object({ ring: hex }).strict()),
  entry_effect: themed(z.object({ accent: hex }).strict()),
} as const;

export type WearableKind = keyof typeof COSMETIC_STYLE_SCHEMAS;

export const WEARABLE_KINDS = Object.keys(COSMETIC_STYLE_SCHEMAS) as WearableKind[];

export function isWearable(kind: string): kind is WearableKind {
  return kind in COSMETIC_STYLE_SCHEMAS;
}

export type CosmeticStyle<K extends WearableKind = WearableKind> = z.infer<
  (typeof COSMETIC_STYLE_SCHEMAS)[K]
>;

/** The style, or null when it is missing or malformed. Never throws. */
export function parseCosmeticStyle<K extends WearableKind>(
  kind: K,
  raw: unknown,
): CosmeticStyle<K> | null {
  const result = COSMETIC_STYLE_SCHEMAS[kind].safeParse(raw);
  return result.success ? (result.data as CosmeticStyle<K>) : null;
}

/**
 * Everything a client needs to draw someone as they have chosen to appear.
 *
 * Every field is independently nullable: a person may wear a frame and nothing
 * else. Attached to seats, chat lines, gift senders and profiles — anywhere a
 * person is drawn.
 */
export interface UserLook {
  frame: { asset: string | null; style: CosmeticStyle<'frame'> } | null;
  bubble: CosmeticStyle<'chat_bubble'> | null;
  nameColor: CosmeticStyle<'nickname_color'> | null;
  entry: { asset: string | null; style: CosmeticStyle<'entry_effect'> } | null;
}

export const EMPTY_LOOK: UserLook = { frame: null, bubble: null, nameColor: null, entry: null };
