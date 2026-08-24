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
export function Collage({ sources = [], heightRatio = 0.46 }: CollageProps) {
  const { width, height } = useWindowDimensions();
  const collageHeight = height * heightRatio;

  // Rows are offset in opposite directions so tiles interlock rather than
  // forming visible columns, and each starts left of zero so the grid runs off
  // both edges — a mosaic that fits inside the screen looks like a gallery.
  const rows = [
    { size: 108, offset: -40, count: Math.ceil(width / 108) + 2 },
    { size: 132, offset: -96, count: Math.ceil(width / 132) + 2 },
    { size: 108, offset: -24, count: Math.ceil(width / 108) + 2 },
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
        locations={[0, 0.92]}
        style={styles.fade}
      />
    </View>
  );
}

/**
 * Stand-ins until real host photos exist.
 *
 * Muted and warm rather than grey: an empty grey grid looks broken, whereas
 * this reads as a deliberate abstract pattern if it ever ships that way.
 */
const PLACEHOLDER_TINTS = [
  colors.bg.raised,
  colors.brand.soft,
  colors.bg.surface,
  colors.currency.coinSoft,
  colors.bg.raised,
  colors.currency.gemSoft,
  colors.bg.surface,
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
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '65%' },
});
