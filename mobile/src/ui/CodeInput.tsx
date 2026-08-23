import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { absoluteFill, colors, radius, spacing, typography } from '@/theme';
import { Text } from '@/ui/Text';

export interface CodeInputProps {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  /** Fires once the last digit lands, so the caller can submit without a button. */
  onFilled?: (code: string) => void;
  /** Turns the boxes red and shakes them. Pass the attempt count so a repeat shakes again. */
  errorKey?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  accessibilityLabel?: string;
}

/**
 * Segmented code entry.
 *
 * One real, invisible TextInput behind boxes that only render. Six separate
 * inputs is the obvious approach and it is wrong: backspace across a boundary,
 * pasting a code, and SMS autofill all break, and each of those is a user who
 * cannot sign in.
 */
export function CodeInput({
  value,
  onChange,
  length = 6,
  onFilled,
  errorKey = 0,
  disabled = false,
  autoFocus = false,
  accessibilityLabel,
}: CodeInputProps) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (errorKey === 0) return;
    // Short, small and damped. A long or wide shake reads as a crash.
    shake.value = withSequence(
      withTiming(-6, { duration: 50 }),
      withTiming(6, { duration: 50 }),
      withTiming(-4, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, [errorKey, shake]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  function handleChange(next: string) {
    const digits = next.replace(/\D/g, '').slice(0, length);
    onChange(digits);
    if (digits.length === length) onFilled?.(digits);
  }

  const isError = errorKey > 0;

  return (
    <Pressable
      onPress={() => input.current?.focus()}
      accessibilityRole="none"
      // The boxes are decorative; the hidden field carries the real semantics.
      accessible={false}
    >
      <Animated.View style={[styles.row, shakeStyle]}>
        {Array.from({ length }, (_, index) => {
          const char = value[index];
          const isNext = focused && index === value.length;
          const isLastWhenFull = focused && value.length === length && index === length - 1;

          return (
            <View
              key={index}
              style={[
                styles.box,
                char !== undefined && styles.boxFilled,
                (isNext || isLastWhenFull) && styles.boxActive,
                isError && styles.boxError,
              ]}
            >
              <Text variant="title" tone={isError ? 'danger' : 'primary'}>
                {char ?? ''}
              </Text>
            </View>
          );
        })}
      </Animated.View>

      <TextInput
        ref={input}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        maxLength={length}
        // Both platforms' one-time-code autofill. Without these the user has to
        // leave the app, read the message and come back — where iOS in
        // particular will have discarded the keyboard state.
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        importantForAutofill="yes"
        accessibilityLabel={accessibilityLabel}
        style={styles.hidden}
        caretHidden
      />
    </Pressable>
  );
}

const BOX_WIDTH = 48;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  box: {
    width: BOX_WIDTH,
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { borderColor: colors.border.strong },
  boxActive: { borderColor: colors.brand.solid, backgroundColor: colors.brand.soft },
  boxError: { borderColor: colors.status.danger },
  /**
   * Positioned over the boxes rather than display:none.
   *
   * A field with zero size or no opacity is skipped by autofill on both
   * platforms — it has to be laid out and focusable to receive a code.
   */
  hidden: {
    ...absoluteFill,
    opacity: 0,
    ...typography.title,
  },
});
