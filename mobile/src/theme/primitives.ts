// LAYER 1 — raw colour values.
//
// ⛔ NEVER import this file from a component, a screen, or anything in ui/,
//    visuals/ or features/. Components import `colors` from '@/theme' instead.
//
// Why two layers: these are named for what they ARE (rose500, neutral900). The
// semantic layer names things for what they are FOR (text.primary, brand.solid).
// Rebranding then means remapping a handful of semantic tokens here in the theme
// folder — not hunting `#FF4D6D` through eighty screens.
//
// Scales run 50 (lightest) to 900 (darkest), the convention every design tool
// uses, so a designer handing over a palette can be pasted in directly.

export const primitives = {
  // Neutrals carry the whole interface: backgrounds, surfaces, text, borders.
  neutral: {
    0: '#FFFFFF',
    50: '#F5F5F7',
    100: '#E4E4EA',
    200: '#C7C7D1',
    300: '#A0A0AE',
    400: '#6B6B7B',
    500: '#4A4A58',
    600: '#3A3A48',
    700: '#2A2A36',
    800: '#1E1E28',
    900: '#15151D',
    1000: '#0B0B10',
  },

  // WARM neutrals — the light theme's spine.
  //
  // Warm rather than a cool grey scale: a pure-grey light UI reads clinical,
  // and this product is meant to feel like an evening out. The ivory base also
  // keeps white cards legible ON it, which a #FFFFFF page cannot do.
  warm: {
    0: '#FFFFFF',
    50: '#FFF9F2',
    100: '#FFF2E4',
    200: '#F6E7D6',
    300: '#F0E2D2',
    400: '#E0CDB8',
    500: '#A6947F',
    600: '#6B5A4B',
    900: '#231A14',
  },

  // Brand. Dhun means melody — warm, not corporate blue.
  rose: {
    300: '#FF8FA3',
    400: '#FF6B87',
    500: '#FF4D6D',
    600: '#E63E5C',
    700: '#C22F49',
    800: '#9E2439',
  },

  // Currency hues. Each is deliberately far from the others in both hue AND
  // lightness, so they stay distinguishable to a colour-blind user and on a
  // cheap screen in a bright room.
  amber: { 300: '#FFD97D', 500: '#FFC53D', 700: '#D9A21E' },
  violet: { 300: '#A594FF', 500: '#7B61FF', 700: '#5B41D9' },
  emerald: { 300: '#6EDCB0', 500: '#31C48D', 700: '#1F9B6C' },

  // Gift tiers. The escalation is the product — a Tier 5 must look expensive.
  blue: { 500: '#4DA3FF' },
  purple: { 500: '#A855F7' },
  orange: { 500: '#FF8A00' },
  gold: { 500: '#FFD700' },

  red: { 500: '#FF3B30', 600: '#E0342A' },

  // Stand-in fills for imagery that has not loaded, or that does not exist yet.
  // Distinct hues at similar lightness, so a grid of them reads as a deliberate
  // pattern rather than as five failed image loads.
  tint: {
    blush: '#FBDDE2',
    peach: '#FBE0C8',
    sand: '#F3E7D2',
    lilac: '#EADDF3',
    mint: '#D9EDE3',
  },

  // Third-party brand marks. Fixed by their owners' guidelines, not ours — they
  // live here so the "no hex outside theme/" rule stays absolute.
  external: {
    facebook: '#1877F2',
    instagram: '#E1306C',
    googleSurface: '#FFFFFF',
  },
  yellow: { 500: '#FFA800' },

  // Alpha values. Kept here rather than inlined so an overlay's darkness is
  // tunable in one place — it gets adjusted constantly during design review.
  alpha: {
    // Fully transparent base. A gradient must fade from the page colour at zero
    // alpha, not from 'transparent': on Android 'transparent' is black-at-zero,
    // which greys the midpoint of every fade over a light image.
    black0: 'rgba(11, 11, 16, 0)',
    black40: 'rgba(11, 11, 16, 0.40)',
    black60: 'rgba(11, 11, 16, 0.60)',
    black86: 'rgba(11, 11, 16, 0.86)',
    white10: 'rgba(255, 255, 255, 0.10)',
    white20: 'rgba(255, 255, 255, 0.20)',
    rose14: 'rgba(255, 77, 109, 0.14)',
    amber16: 'rgba(255, 197, 61, 0.16)',
    violet16: 'rgba(123, 97, 255, 0.16)',
    emerald16: 'rgba(49, 196, 141, 0.16)',

    // Light-theme fades and soft fills.
    warm0: 'rgba(255, 249, 242, 0)',
    warm55: 'rgba(255, 249, 242, 0.55)',
    warm30: 'rgba(255, 249, 242, 0.30)',
    red12: 'rgba(255, 59, 48, 0.12)',
    yellow16: 'rgba(255, 168, 0, 0.16)',
    warmInk08: 'rgba(35, 26, 20, 0.08)',
  },
} as const;
