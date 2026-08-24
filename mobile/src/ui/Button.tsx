import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui/Text';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  /**
   * Already-translated text. A string rather than children, so a button can
   * never end up with a hardcoded English label that bypassed t().
   */
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  left?: ReactNode;
  right?: ReactNode;
  testID?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Solid variants use INVERSE (near-black) text, not white.
 *
 * White on the brand rose is 3.2:1 — it fails WCAG AA for anything that is not
 * large text, and a 15px button label is not large text. Near-black on rose is
 * 6:1. It also happens to look right on a hot pink.
 */
const variants: Record<
  Variant,
  { bg: string; pressed: string; tone: 'onBrand' | 'primary' | 'brand'; border?: string }
> = {
  primary: { bg: colors.brand.solid, pressed: colors.brand.pressed, tone: 'onBrand' },
  secondary: {
    bg: colors.bg.raised,
    pressed: colors.bg.pressed,
    tone: 'primary',
    border: colors.border.subtle,
  },
  danger: { bg: colors.status.danger, pressed: colors.status.dangerPressed, tone: 'onBrand' },
  ghost: { bg: 'transparent', pressed: colors.bg.pressed, tone: 'brand' },
};

const sizes = {
  sm: { height: 36, paddingHorizontal: spacing.lg, variant: 'caption' },
  md: { height: 48, paddingHorizontal: spacing.xl, variant: 'bodyStrong' },
  lg: { height: 56, paddingHorizontal: spacing.xl, variant: 'heading' },
} as const;

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  left,
  right,
  testID,
  accessibilityHint,
  style,
}: ButtonProps) {
  const v = variants[variant];
  const s = sizes[size];
  // A loading button must not fire again — a double-tapped "Send code" is two
  // OTPs and a rate-limit hit the user did not cause.
  const inert = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      hitSlop={size === 'sm' ? spacing.sm : undefined}
      style={({ pressed }) => [
        styles.base,
        {
          height: s.height,
          paddingHorizontal: s.paddingHorizontal,
          backgroundColor: disabled ? colors.bg.pressed : pressed ? v.pressed : v.bg,
          ...(v.border !== undefined && {
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: v.border,
          }),
          ...(fullWidth && { alignSelf: 'stretch' as const }),
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.text.faint} />
      ) : (
        left !== undefined && <View>{left}</View>
      )}
      <Text variant={s.variant} tone={disabled ? 'faint' : v.tone} numberOfLines={1}>
        {label}
      </Text>
      {right !== undefined && <View>{right}</View>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
  },
});

/** Exported so a screen can size a skeleton to match without guessing. */
export const buttonHeight = {
  sm: sizes.sm.height,
  md: sizes.md.height,
  lg: sizes.lg.height,
} as const;

export type { Variant as ButtonVariant, Size as ButtonSize };
