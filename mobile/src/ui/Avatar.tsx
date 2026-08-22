import { Image } from 'expo-image';
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
  testID?: string;
}

/**
 * A user or host avatar, with a deterministic fallback.
 *
 * Most users never set a photo, so the fallback is the common case rather than
 * the edge case — an empty grey circle across a whole feed looks broken.
 */
export function Avatar({ uri, name, size = 'md', live = false, testID }: AvatarProps) {
  const px = sizes[size];
  const initial = name.trim().charAt(0).toUpperCase() || '?';

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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, borderRadius: radius.pill },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.raised },
});

/** So a list row can reserve space before the avatar loads. */
export const avatarSize = sizes;
