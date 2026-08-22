// LAYER 2 — semantic colour tokens.
//
// ✅ THIS IS THE ONLY COLOUR SOURCE COMPONENTS MAY IMPORT.
//
// Every token is named for its JOB, not its hue. A component asks for
// `colors.text.secondary`, never for "grey" and never for a hex value. That is
// what makes a rebrand a change to this file alone.
//
// Adding a colour? Add a SEMANTIC token here that points at a primitive. If no
// primitive fits, add one to primitives.ts first. Never write a hex literal
// outside the theme folder — the lint rule will reject it.
//
// Dark-first and, for now, dark-only. Peak usage is 8pm–2am over live video, and
// every competitor in this category is dark for the same reason. The shape below
// is a plain object so a second theme can be introduced later by swapping which
// object is exported, without touching a single component.

import { primitives as p } from './primitives';

export const colors = {
  /** Backgrounds and surfaces, from furthest back to nearest front. */
  bg: {
    /** The app canvas. */
    base: p.neutral[1000],
    /** Cards, sheets, tab bars — one step forward. */
    surface: p.neutral[900],
    /** Menus and popovers on top of a surface. */
    raised: p.neutral[800],
    /** Pressed state for any tappable surface. */
    pressed: p.neutral[700],
    /** Behind a modal or a full-screen gift. */
    scrim: p.alpha.black86,
    /** Gradient foot under room chrome so white text stays readable on video. */
    videoScrim: p.alpha.black60,
  },

  text: {
    /** Default body and headings. */
    primary: p.neutral[50],
    /** Supporting copy, timestamps, secondary labels. */
    secondary: p.neutral[300],
    /** Placeholders and disabled labels. Fails contrast for body text by design. */
    faint: p.neutral[400],
    /** On top of a brand-coloured or light surface. */
    inverse: p.neutral[1000],
    /** Text laid directly over video. Always paired with bg.videoScrim. */
    onMedia: p.neutral[0],
  },

  border: {
    subtle: p.neutral[700],
    strong: p.neutral[600],
    /** Focus ring and selected state. */
    focus: p.rose[500],
  },

  brand: {
    solid: p.rose[500],
    pressed: p.rose[600],
    /** Tinted background for badges and selected chips. */
    soft: p.alpha.rose14,
    /** Brand-coloured text and icons on a dark surface. */
    onDark: p.rose[400],
  },

  /**
   * Currencies. FIXED, and never substituted.
   *
   * A user must tell coins from gems at a glance, mid-stream, without reading
   * the label. Using brand colour for a balance, or reusing the coin gold for a
   * warning, breaks that instantly — so these three are reserved.
   */
  currency: {
    coin: p.amber[500],
    coinSoft: p.alpha.amber16,
    gem: p.violet[500],
    gemSoft: p.alpha.violet16,
    point: p.emerald[500],
    pointSoft: p.alpha.emerald16,
  },

  /** Gift tiers 1–5. Indexed so `colors.tier[gift.tier]` works directly. */
  tier: {
    1: p.neutral[300],
    2: p.blue[500],
    3: p.purple[500],
    4: p.orange[500],
    5: p.gold[500],
  },

  status: {
    /** The live dot. Reserved — never used for errors. */
    live: p.red[500],
    success: p.emerald[500],
    warning: p.yellow[500],
    danger: p.red[500],
    dangerPressed: p.red[600],
  },

  /** Translucent fills over video or imagery, where a solid surface would hide content. */
  glass: {
    fill: p.alpha.white10,
    fillStrong: p.alpha.white20,
    scrim: p.alpha.black40,
  },
} as const;

export type Colors = typeof colors;
/** Every valid tier key, so `colors.tier[n]` stays type-safe. */
export type TierKey = keyof Colors['tier'];
