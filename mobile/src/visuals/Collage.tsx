import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { absoluteFill, colors, radius, spacing } from '@/theme';

export interface CollageProps {
  /**
   * Faces to show. Fewer than the grid needs is fine — tiles repeat, and a
   * missing source renders as a tinted placeholder rather than a hole.
   */
  sources?: string[];
  /** Fraction of the screen height the collage occupies. */
  heightRatio?: number;
}

/**
 * The tilted mosaic behind the login screen.
 *
 * It exists to answer "who is on this app?" before a single word is read —
 * which is the one thing a sign-in screen for a social product has to do.
 * Everything about it is therefore in service of the faces: the tilt, the
 * overflow past both edges, and the fade into the page all say "there is more
 * of this than fits".
 *
 * Static by design. A drifting or looping collage is the first thing that reads
 * as a template, and it costs battery on the screen where the app is judged.
 */
export function Collage({ sources = [], heightRatio = 0.5 }: CollageProps) {
  const { width, height } = useWindowDimensions();
  const collageHeight = height * heightRatio;

  // Rows are offset in opposite directions so tiles interlock rather than
  // forming visible columns, and each starts left of zero so the grid runs off
  // both edges — a mosaic that fits inside the screen looks like a gallery.
  const rows = [
    { size: 96, offset: -40, count: Math.ceil((width * 1.6) / 96) },
    { size: 116, offset: -88, count: Math.ceil((width * 1.6) / 116) },
    { size: 96, offset: -24, count: Math.ceil((width * 1.6) / 96) },
    // A fourth row that is mostly hidden under the fade. Three rows plus an
    // 8-degree rotation leaves bare background in the bottom corners, which
    // reads as a layout bug rather than as a design.
    { size: 108, offset: -70, count: Math.ceil((width * 1.6) / 108) },
  ];

  let tileIndex = 0;

  return (
    <View style={[styles.container, { height: collageHeight }]} pointerEvents="none">
      <Animated.View
        entering={FadeIn.duration(500)}
        // Rotated AND over-scaled: rotation alone would expose the background
        // at the corners, which reads as a rendering bug.
        style={[styles.grid, { width: width * 1.5, top: -spacing.xxl }]}
      >
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={[styles.row, { marginLeft: row.offset }]}>
            {Array.from({ length: row.count }, () => {
              const source = sources.length > 0 ? sources[tileIndex % sources.length] : undefined;
              const placeholderTint = PLACEHOLDER_TINTS[tileIndex % PLACEHOLDER_TINTS.length];
              tileIndex += 1;

              return (
                <View
                  key={tileIndex}
                  style={[styles.tile, { width: row.size, height: row.size * 1.25 }]}
                >
                  {source === undefined ? (
                    <View style={[styles.placeholder, { backgroundColor: placeholderTint }]} />
                  ) : (
                    <Image
                      source={{ uri: source }}
                      style={styles.image}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      transition={200}
                    />
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </Animated.View>

      {/*
        Two gradients, not one. The bottom fade dissolves the grid into the page
        so there is no hard edge to notice; the flat scrim over the whole thing
        drops the contrast far enough that white text and the buttons below stay
        the brightest things on screen. Without the second one the faces compete
        with the primary action.
      */}
      <View style={styles.scrim} />
      <LinearGradient
        colors={[colors.bg.baseTransparent, colors.bg.base]}
        locations={[0, 0.88]}
        style={styles.fade}
      />
    </View>
  );
}

/**
 * Stand-ins until real host photos exist.
 *
 * Five distinct hues at similar lightness. The first version reused surface and
 * badge tokens, which on an ivory page are all within a few percent of the
 * background — the grid was there but invisible, and the screen looked like a
 * handful of stray rectangles.
 */
const PLACEHOLDER_TINTS = [
  colors.placeholder.a,
  colors.placeholder.b,
  colors.placeholder.c,
  colors.placeholder.d,
  colors.placeholder.e,
];

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  grid: {
    position: 'absolute',
    left: '-25%',
    transform: [{ rotate: '-8deg' }, { scale: 1.1 }],
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.bg.surface },
  image: { flex: 1 },
  placeholder: { flex: 1 },
  scrim: { ...absoluteFill, backgroundColor: colors.glass.wash },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '48%' },
});
