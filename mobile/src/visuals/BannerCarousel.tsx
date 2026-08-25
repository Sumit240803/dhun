import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { MockBanner } from '@/mocks';
import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui/Text';

export interface BannerCarouselProps {
  banners: MockBanner[];
  onPress: (banner: MockBanner) => void;
}

/**
 * The campaign strip above the feed.
 *
 * Paged and manual — it does NOT auto-advance. An auto-rotating banner moves
 * the thing under a thumb that was about to tap it, and it is the single most
 * complained-about pattern in apps of this shape. The dots say there is more;
 * the user decides when.
 */
export function BannerCarousel({ banners, onPress }: BannerCarouselProps) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const pageWidth = width - spacing.lg * 2;
  const lastIndex = useRef(0);

  function handleScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(event.nativeEvent.contentOffset.x / (pageWidth + spacing.md));
    if (next !== lastIndex.current) {
      lastIndex.current = next;
      setIndex(next);
    }
  }

  if (banners.length === 0) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        pagingEnabled={false}
        snapToInterval={pageWidth + spacing.md}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        contentContainerStyle={styles.track}
      >
        {banners.map((banner) => (
          <Pressable
            key={banner.id}
            onPress={() => onPress(banner)}
            accessibilityRole="button"
            accessibilityLabel={`${banner.title}. ${banner.subtitle}`}
            style={({ pressed }) => [
              styles.banner,
              { width: pageWidth },
              pressed && styles.pressed,
            ]}
          >
            <LinearGradient
              colors={THEMES[banner.theme]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.content}>
              <Text variant="bodyStrong" tone="onMedia" numberOfLines={1}>
                {banner.title}
              </Text>
              <Text variant="caption" tone="onMedia" numberOfLines={2}>
                {banner.subtitle}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {banners.length > 1 && (
        <View style={styles.dots}>
          {banners.map((banner, dotIndex) => (
            <View key={banner.id} style={[styles.dot, dotIndex === index && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * The server names a theme; the client owns the colours.
 *
 * A config row must never carry a hex value — that would put a colour outside
 * `theme/` and outside the lint rule, and a bad campaign could then paint an
 * unreadable banner with no way to fix it but a release.
 */
const THEMES: Record<MockBanner['theme'], [string, string]> = {
  gold: [colors.currency.coin, colors.status.warning],
  rose: [colors.brand.solid, colors.brand.accent],
  violet: [colors.currency.gem, colors.tier[3]],
};

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  track: { paddingHorizontal: spacing.lg, gap: spacing.md },
  banner: {
    height: 92,
    borderRadius: radius.lg,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.9 },
  content: { paddingHorizontal: spacing.lg, gap: 2 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs },
  dot: {
    width: 5,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border.strong,
  },
  dotActive: { width: 14, backgroundColor: colors.brand.solid },
});
