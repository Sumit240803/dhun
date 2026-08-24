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
// LIGHT IS THE DEFAULT. Two complete palettes are defined below with identical
// shapes, and `colors` is whichever one `MODE` names. That was the plan from the
// start — "a second theme can be introduced later by swapping which object is
// exported, without touching a single component" — and it held: switching cost
// this file plus the handful of places that hard-coded a polarity (the status
// bar, the date picker's variant, the media wash).
//
// Deliberately a STATIC export rather than a React context. Every screen reads
// these inside `StyleSheet.create`, which runs once at module load; making the
// palette reactive would mean a hook in every component. When per-user theme
// switching is actually wanted, that is the change to make — not before.

import { primitives as p } from './primitives';

/** Which palette ships. Also tells the few polarity-aware APIs which way is up. */
export const MODE: 'light' | 'dark' = 'light';

const light = {
  /** Backgrounds and surfaces, from furthest back to nearest front. */
  bg: {
    /** The app canvas. Warm ivory, not white — white cards must read ON it. */
    base: p.warm[50],
    /** Cards, sheets, tab bars — one step forward. */
    surface: p.warm[0],
    /** Menus and popovers on top of a surface. */
    raised: p.warm[100],
    /** Pressed state for any tappable surface. */
    pressed: p.warm[200],
    /** Behind a modal or a full-screen gift. Dark in BOTH themes — a scrim's
     *  job is to kill the page behind it, and a pale one does not. */
    scrim: p.alpha.black86,
    /** Gradient foot under room chrome so white text stays readable on video. */
    videoScrim: p.alpha.black60,
    /** `base` at zero alpha — the starting stop of any fade INTO the page. */
    baseTransparent: p.alpha.warm0,
  },

  text: {
    /** Default body and headings. Warm near-black, never pure #000. */
    primary: p.warm[900],
    /** Supporting copy, timestamps, secondary labels. */
    secondary: p.warm[600],
    /** Placeholders and disabled labels. Fails contrast for body text by design. */
    faint: p.warm[500],
    /** On an inverted surface — a dark sheet inside a light app. */
    inverse: p.warm[0],
    /**
     * On a saturated brand or status fill.
     *
     * Near-black in BOTH themes, and that is not an oversight: white on the
     * brand rose is 3.2:1 and fails AA for a 15px label, where near-black is
     * 6:1. A hot pink wants dark text on it.
     */
    onBrand: p.warm[900],
    /** Text laid directly over video. Always paired with bg.videoScrim. */
    onMedia: p.neutral[0],
  },

  border: {
    subtle: p.warm[300],
    strong: p.warm[400],
    /** Focus ring and selected state. */
    focus: p.rose[500],
  },

  brand: {
    solid: p.rose[500],
    pressed: p.rose[600],
    /** Tinted background for badges and selected chips. */
    soft: p.alpha.rose14,
    /** Brand-coloured TEXT and icons. Darker than `solid`, because a link has
     *  to clear 4.5:1 against the page where a button surface does not. */
    accent: p.rose[700],
  },

  /**
   * Currencies. FIXED, and never substituted.
   *
   * A user must tell coins from gems at a glance, mid-stream, without reading
   * the label. Using brand colour for a balance, or reusing the coin gold for a
   * warning, breaks that instantly — so these three are reserved.
   */
  currency: {
    coin: p.amber[700],
    coinSoft: p.alpha.amber16,
    gem: p.violet[700],
    gemSoft: p.alpha.violet16,
    point: p.emerald[700],
    pointSoft: p.alpha.emerald16,
  },

  /** Gift tiers 1–5. Indexed so `colors.tier[gift.tier]` works directly. */
  tier: {
    1: p.warm[600],
    2: p.blue[500],
    3: p.purple[500],
    4: p.orange[500],
    5: p.amber[700],
  },

  status: {
    /** The live dot. Reserved — never used for errors. */
    live: p.red[500],
    success: p.emerald[700],
    successSoft: p.alpha.emerald16,
    warning: p.yellow[500],
    warningSoft: p.alpha.yellow16,
    danger: p.red[600],
    dangerSoft: p.alpha.red12,
    dangerPressed: p.red[600],
  },

  /**
   * Third-party sign-in marks. Their owners dictate these, so they are not
   * rebrandable and must never be swapped for a Dhun colour.
   */
  provider: {
    facebook: p.external.facebook,
    instagram: p.external.instagram,
    googleSurface: p.external.googleSurface,
  },

  /** Translucent fills over video or imagery, where a solid surface would hide content. */
  glass: {
    fill: p.alpha.warmInk08,
    fillStrong: p.alpha.white20,
    scrim: p.alpha.black40,
    /**
     * Flat wash that pushes media back so foreground text wins.
     *
     * Theme-dependent in the one way that matters: over the same photograph, a
     * light page needs a WHITE veil and a dark page a black one.
     */
    wash: p.alpha.warm55,
  },
} as const;

/**
 * The palette SHAPE: same keys, every leaf relaxed to `string`.
 *
 * Without this, `as const` on `light` would make each value a literal type and
 * the dark palette would be required to equal the light hex values — every line
 * an error. Keys stay exactly required, which is the part that matters.
 */
type Themed<T> = { [K in keyof T]: T[K] extends string ? string : Themed<T[K]> };

/**
 * The dark palette. Kept complete and in step with `light` — not commented out
 * — so switching is one line rather than an archaeology exercise.
 */
const dark: Themed<typeof light> = {
  bg: {
    base: p.neutral[1000],
    surface: p.neutral[900],
    raised: p.neutral[800],
    pressed: p.neutral[700],
    scrim: p.alpha.black86,
    videoScrim: p.alpha.black60,
    baseTransparent: p.alpha.black0,
  },

  text: {
    primary: p.neutral[50],
    secondary: p.neutral[300],
    faint: p.neutral[400],
    inverse: p.neutral[1000],
    onBrand: p.neutral[1000],
    onMedia: p.neutral[0],
  },

  border: {
    subtle: p.neutral[700],
    strong: p.neutral[600],
    focus: p.rose[500],
  },

  brand: {
    solid: p.rose[500],
    pressed: p.rose[600],
    soft: p.alpha.rose14,
    accent: p.rose[400],
  },

  currency: {
    coin: p.amber[500],
    coinSoft: p.alpha.amber16,
    gem: p.violet[500],
    gemSoft: p.alpha.violet16,
    point: p.emerald[500],
    pointSoft: p.alpha.emerald16,
  },

  tier: {
    1: p.neutral[300],
    2: p.blue[500],
    3: p.purple[500],
    4: p.orange[500],
    5: p.gold[500],
  },

  status: {
    live: p.red[500],
    success: p.emerald[500],
    successSoft: p.alpha.emerald16,
    warning: p.yellow[500],
    warningSoft: p.alpha.yellow16,
    danger: p.red[500],
    dangerSoft: p.alpha.red12,
    dangerPressed: p.red[600],
  },

  provider: {
    facebook: p.external.facebook,
    instagram: p.external.instagram,
    googleSurface: p.external.googleSurface,
  },

  glass: {
    fill: p.alpha.white10,
    fillStrong: p.alpha.white20,
    scrim: p.alpha.black40,
    wash: p.alpha.black40,
  },
} as const;

export const colors: Themed<typeof light> = MODE === 'light' ? light : dark;

export type Colors = Themed<typeof light>;
/** Every valid tier key, so `colors.tier[n]` stays type-safe. */
export type TierKey = keyof Colors['tier'];
