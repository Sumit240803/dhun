import { useEffect } from 'react';
import { StyleSheet, type DimensionValue } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius } from '@/theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  /** Match the shape being stood in for: `pill` for an avatar, `md` for a card. */
  rounding?: keyof typeof radius;
  style?: object;
}

/**
 * A placeholder for content that is loading.
 *
 * This is the deliberate exception to "nothing loops": a pulse is what says
 * "still working" rather than "this is what the screen looks like". A perfectly
 * static grey block reads as broken content, which is the failure mode the
 * skeleton exists to avoid. Slow and shallow, so it recedes.
 */
export function Skeleton({ width = '100%', height = 16, rounding = 'sm', style }: SkeletonProps) {
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.base, { width, height, borderRadius: radius[rounding] }, pulseStyle, style]}
    />
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.bg.raised },
});
