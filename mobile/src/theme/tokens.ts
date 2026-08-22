// Non-colour design tokens: spacing, radius, typography, layering, timing.
//
// Colour lives in colors.ts and is imported separately. Keeping them apart means
// a rebrand touches one file, and a spacing change touches a different one.

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
} as const;

/**
 * Stacking order, centralised.
 *
 * Gift animations MUST sit above room chrome, and a Tier 5 global announcement
 * above everything except a modal. Left to per-component guesses, a 15,000-rupee
 * Galaxy ends up rendering behind the chat overlay.
 */
export const zIndex = {
  base: 0,
  roomChrome: 10,
  giftInline: 20,
  giftFullscreen: 30,
  roomBanner: 40,
  globalAnnouncement: 50,
  sheet: 60,
  modal: 70,
  toast: 80,
} as const;

export const duration = {
  fast: 150,
  normal: 250,
  slow: 400,
  /** Tier 3+ animations run long; the gift queue depends on these being honest. */
  giftFullscreen: 3_000,
  giftBanner: 5_000,
  giftGlobal: 6_000,
} as const;

/**
 * Fills the parent.
 *
 * React Native 0.86 dropped `StyleSheet.absoluteFillObject` from its types, and
 * `absoluteFill` is a registered style id that cannot be spread. Explicit
 * positioning is version-proof and reads more clearly anyway.
 */
export const absoluteFill = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
} as const;
