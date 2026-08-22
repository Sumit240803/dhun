import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

export interface CardProps {
  children: ReactNode;
  /** Makes the whole card tappable, with a pressed state. */
  onPress?: () => void;
  /** Highlights the card with the brand border — a selected coin pack. */
  selected?: boolean;
  /** Translucent instead of solid, for cards laid over video or artwork. */
  glass?: boolean;
  padded?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  onPress,
  selected = false,
  glass = false,
  padded = true,
  testID,
  style,
}: CardProps) {
  const base: StyleProp<ViewStyle> = [
    styles.base,
    padded && styles.padded,
    glass ? styles.glass : styles.solid,
    selected && styles.selected,
    style,
  ];

  if (onPress === undefined) {
    return (
      <View style={base} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [base, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    overflow: 'hidden',
  },
  padded: { padding: spacing.lg },
  solid: { backgroundColor: colors.bg.surface },
  glass: { backgroundColor: colors.glass.fill, borderColor: colors.glass.fillStrong },
  selected: { borderColor: colors.brand.solid, backgroundColor: colors.brand.soft },
  pressed: { backgroundColor: colors.bg.pressed },
});
