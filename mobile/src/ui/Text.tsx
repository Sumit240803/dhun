import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';

import { colors, typography } from '@/theme';

type Variant = keyof typeof typography;
type Tone =
  'primary' | 'secondary' | 'faint' | 'inverse' | 'onBrand' | 'onMedia' | 'brand' | 'danger';

export interface TextProps extends RNTextProps {
  variant?: Variant;
  tone?: Tone;
}

const tones: Record<Tone, string> = {
  primary: colors.text.primary,
  secondary: colors.text.secondary,
  faint: colors.text.faint,
  inverse: colors.text.inverse,
  onBrand: colors.text.onBrand,
  onMedia: colors.text.onMedia,
  brand: colors.brand.accent,
  danger: colors.status.danger,
};

/**
 * WORKED EXAMPLE for `ui/`: styled, dumb, reusable, and knows nothing about
 * coins or rooms.
 *
 * Variant and tone rather than free-form style props — that is what keeps
 * typography consistent across forty screens without anyone having to remember
 * which font size a caption uses.
 */
export function Text({ variant = 'body', tone = 'primary', style, ...rest }: TextProps) {
  return <RNText style={[styles[variant], { color: tones[tone] }, style]} {...rest} />;
}

const styles = StyleSheet.create({
  display: typography.display,
  title: typography.title,
  heading: typography.heading,
  body: typography.body,
  bodyStrong: typography.bodyStrong,
  caption: typography.caption,
  micro: typography.micro,
});
