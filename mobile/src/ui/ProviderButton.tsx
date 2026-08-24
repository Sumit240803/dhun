import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui/Text';

export interface ProviderButtonProps {
  /** Already-translated, e.g. "Log in with Google". */
  label: string;
  /**
   * The provider's mark, as a slot.
   *
   * A slot rather than a name because these are other companies' trademarks:
   * Google in particular requires its official multi-colour G at a specified
   * size and clear space, and swapping a placeholder glyph for the real asset
   * must not mean touching this component.
   */
  icon: ReactNode;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}

/**
 * One row in a list of sign-in providers.
 *
 * Outlined and full width, with the mark left and the label centred — the
 * layout every social login sheet uses, because it lets someone find their
 * provider by logo without reading a word.
 */
export function ProviderButton({
  label,
  icon,
  onPress,
  loading = false,
  disabled = false,
  testID,
}: ProviderButtonProps) {
  const inert = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={({ pressed }) => [styles.base, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.mark}>
        {loading ? <ActivityIndicator size="small" color={colors.text.faint} /> : icon}
      </View>
      <Text
        variant="bodyStrong"
        tone={disabled ? 'faint' : 'primary'}
        numberOfLines={1}
        style={styles.label}
      >
        {label}
      </Text>
      {/* Balances the mark so the label sits optically centred, not pushed right. */}
      <View style={styles.mark} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  disabled: { opacity: 0.5 },
  mark: { width: 32, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, textAlign: 'center' },
});
