// The theme's public surface. Components import from '@/theme' and nothing else.
//
// primitives.ts is deliberately NOT re-exported: raw colour scales are an
// implementation detail of colors.ts, and exposing them here would let a
// component reach past the semantic layer.

export { colors, MODE } from './colors';
export type { Colors, TierKey } from './colors';
export { spacing, radius, typography, zIndex, duration, absoluteFill } from './tokens';
