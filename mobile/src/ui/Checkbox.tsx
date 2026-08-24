import { Ionicons } from '@expo/vector-icons';
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme';

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The label. A node rather than a string so it can carry inline links. */
  children: ReactNode;
  /** Read out instead of the children, which assistive tech cannot flatten well. */
  accessibilityLabel: string;
  disabled?: boolean;
  testID?: string;
}

/**
 * An explicit opt-in.
 *
 * Unticked by default and never pre-ticked: India's DPDP Act 2023 requires
 * consent to be freely given and specific, and a pre-ticked box is the textbook
 * example of neither. It is also what store review looks for.
 */
export function Checkbox({
  checked,
  onChange,
  children,
  accessibilityLabel,
  disabled = false,
  testID,
}: CheckboxProps) {
  const scale = useSharedValue(checked ? 1 : 0);

  // In an effect, not during render: React Compiler treats a render-time write
  // to a shared value as a side effect, and it would run twice under Strict Mode.
  useEffect(() => {
    scale.value = withTiming(checked ? 1 : 0, { duration: 140 });
  }, [checked, scale]);

  const tickStyle = useAnimatedStyle(() => ({
    opacity: scale.value,
    transform: [{ scale: 0.6 + scale.value * 0.4 }],
  }));

  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled }}
      // The box alone is a 20pt target. The row is what the finger actually
      // gets, which is the difference between a consent gate people tick and
      // one they give up on.
      hitSlop={spacing.sm}
      style={styles.row}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        <Animated.View style={tickStyle}>
          <Ionicons name="checkmark" size={14} color={colors.text.inverse} />
        </Animated.View>
      </View>
      <View style={styles.label}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  box: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
    // Nudged down so the box sits on the text baseline rather than its box top.
    marginTop: 1,
  },
  boxChecked: { backgroundColor: colors.brand.solid, borderColor: colors.brand.solid },
  label: { flex: 1 },
});
