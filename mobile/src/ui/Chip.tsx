import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui/Text';

export interface ChipProps {
  /** Already-translated label. */
  label: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

/**
 * A single-tap choice in a row of choices.
 *
 * Used where a full segmented control is heavier than the decision deserves —
 * gender at signup, a room category filter, a combo multiplier. Reports
 * `selected` to assistive tech, which is the part hand-rolled chips always miss.
 */
export function Chip({ label, selected = false, onPress, disabled = false, testID }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : styles.idle,
        pressed && !selected && styles.pressed,
      ]}
    >
      <Text variant="caption" tone={selected ? 'brand' : 'secondary'} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  idle: { borderColor: colors.border.subtle, backgroundColor: colors.bg.surface },
  selected: { borderColor: colors.brand.solid, backgroundColor: colors.brand.soft },
  pressed: { backgroundColor: colors.bg.pressed },
});
