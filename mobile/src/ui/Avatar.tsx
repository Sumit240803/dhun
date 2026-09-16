import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme';
import { Text } from '@/ui/Text';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizes: Record<Size, number> = { xs: 24, sm: 32, md: 44, lg: 64, xl: 96 };
const textVariant: Record<Size, 'micro' | 'caption' | 'bodyStrong' | 'heading' | 'title'> = {
  xs: 'micro',
  sm: 'micro',
  md: 'caption',
  lg: 'heading',
  xl: 'title',
};

export interface AvatarProps {
  uri?: string | null;
  /** Used for the initial when there is no image, and for the accessibility label. */
  name: string;
  size?: Size;
  /** Draws the live ring. Reserved for an actually-broadcasting host. */
  live?: boolean;
  /**
   * An equipped avatar frame — a cosmetic, bought with gems.
   *
   * Drawn OVER the avatar and larger than it, because every frame asset is
   * designed with ornament that extends past the circle: wings, a crown, a
   * glow. Clipping it to the avatar's box would cut off the part people paid
   * for. The avatar keeps its size; the frame spills outside it, and callers
   * leave room for that.
   */
  frameUri?: string | null;
  /**
   * A ring drawn in code for the same frame — shown while its art loads, and
   * instead of it when the art cannot load at all. Without it, a frame someone
   * paid for is simply invisible on a bad connection.
   */
  frameRing?: string | null;
  testID?: string;
}

/**
 * How much bigger than the avatar a frame is drawn.
 *
 * One number for every frame, so designers have a fixed canvas to work to:
 * a frame asset is `FRAME_SCALE` times the avatar, with the avatar centred.
 */
export const FRAME_SCALE = 1.36;

/**
 * A user or host avatar, with a deterministic fallback.
 *
 * Most users never set a photo, so the fallback is the common case rather than
 * the edge case — an empty grey circle across a whole feed looks broken.
 */
export function Avatar({
  uri,
  name,
  size = 'md',
  live = false,
  frameUri,
  frameRing,
  testID,
}: AvatarProps) {
  const px = sizes[size];
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  // Keyed on the uri, so a different frame starts fresh rather than inheriting
  // the last one's failure.
  const [loadedFrame, setLoadedFrame] = useState<string | null>(null);
  const [failedFrame, setFailedFrame] = useState<string | null>(null);
  const frameShowing = !!frameUri && loadedFrame === frameUri && failedFrame !== frameUri;
  const ringWidth = Math.max(2, Math.round(px * 0.06));

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        { width: px, height: px, borderRadius: radius.pill },
        live && { borderWidth: 2, borderColor: colors.status.live, padding: 2 },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.fill}
          contentFit="cover"
          // A cached avatar is the difference between a feed that pops in and
          // one that renders instantly on the second scroll.
          cachePolicy="memory-disk"
          transition={150}
        />
      ) : (
        <View style={[styles.fill, styles.fallback]}>
          <Text variant={textVariant[size]} tone="secondary">
            {initial}
          </Text>
        </View>
      )}

      {frameRing && !frameShowing ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no"
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -ringWidth,
            top: -ringWidth,
            width: px + ringWidth * 2,
            height: px + ringWidth * 2,
            borderRadius: radius.pill,
            borderWidth: ringWidth,
            borderColor: frameRing,
          }}
        />
      ) : null}

      {frameUri && failedFrame !== frameUri ? (
        <Image
          source={{ uri: frameUri }}
          // Not announced separately — it is decoration on an avatar that is
          // already labelled with the person's name.
          accessibilityElementsHidden
          importantForAccessibility="no"
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: px * FRAME_SCALE,
            height: px * FRAME_SCALE,
            left: (px - px * FRAME_SCALE) / 2,
            top: (px - px * FRAME_SCALE) / 2,
          }}
          contentFit="contain"
          cachePolicy="memory-disk"
          onLoad={() => setLoadedFrame(frameUri)}
          onError={() => setFailedFrame(frameUri)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, borderRadius: radius.pill },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.raised },
});

/** So a list row can reserve space before the avatar loads. */
export const avatarSize = sizes;
