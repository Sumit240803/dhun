import { useState, type ReactNode, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';
import { Text } from '@/ui/Text';

export interface InputProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label?: string;
  /** Validation message. Its presence turns the field red — pass undefined when valid. */
  error?: string;
  /** Guidance shown while there is no error. */
  helper?: string;
  /** Fixed leading text that is not part of the value — a "+91" dial code. */
  prefix?: string;
  right?: ReactNode;
  ref?: Ref<TextInput>;
}

/**
 * A text field with its label, focus ring and error message in one place.
 *
 * The error is rendered in a fixed slot below the field rather than replacing
 * the helper text in-place, so validating a form does not shift every control
 * beneath it down the screen.
 */
export function Input({
  label,
  error,
  helper,
  prefix,
  right,
  ref,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);

  const borderColor =
    error !== undefined
      ? colors.status.danger
      : focused
        ? colors.border.focus
        : colors.border.subtle;

  return (
    <View style={styles.wrapper}>
      {label !== undefined && (
        <Text variant="caption" tone="secondary">
          {label}
        </Text>
      )}

      <View style={[styles.field, { borderColor }]}>
        {prefix !== undefined && (
          <Text variant="body" tone="secondary">
            {prefix}
          </Text>
        )}
        <TextInput
          ref={ref}
          style={styles.input}
          placeholderTextColor={colors.text.faint}
          selectionColor={colors.brand.solid}
          // React Native has no accessibilityState.invalid, so the error is
          // folded into the label — otherwise the red border is the only signal
          // that the field is wrong, which is no signal at all to a screen reader.
          accessibilityLabel={error === undefined ? label : `${label ?? ''} ${error}`.trim()}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
        {right}
      </View>

      {(error ?? helper) !== undefined && (
        <Text variant="caption" tone={error !== undefined ? 'danger' : 'faint'}>
          {error ?? helper}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text.primary,
    // Android centres text oddly inside a fixed-height row without this.
    padding: 0,
  },
});
