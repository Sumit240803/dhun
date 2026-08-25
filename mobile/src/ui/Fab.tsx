import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui/Text';

export interface FabProps {
  /** Already-translated. */
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Lifts it clear of the tab bar. */
  bottomOffset?: number;
  testID?: string;
}

/**
 * The one action a screen exists to provoke — going live, opening a party.
 *
 * Extended (icon plus label) rather than a bare circle: a lone camera glyph in
 * the corner is ambiguous, and this is the button the entire host-supply side
 * of the business depends on being tapped.
 */
export function Fab({ label, icon, onPress, bottomOffset = spacing.lg, testID }: FabProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(280).delay(200)}
      style={[styles.wrapper, { bottom: bottomOffset }]}
    >
      <Pressable
        onPress={onPress}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Ionicons name={icon} size={20} color={colors.text.onBrand} />
        <Text variant="bodyStrong" tone="onBrand">
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', right: spacing.lg },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.solid,
    // Lifted off the feed so it reads as floating above it, not printed on it.
    shadowColor: colors.text.primary,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  pressed: { backgroundColor: colors.brand.pressed },
});
