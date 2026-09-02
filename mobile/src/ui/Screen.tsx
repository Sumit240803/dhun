import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  /** Padding from the layout scale. Off for full-bleed screens — a room, a feed. */
  padded?: boolean;
  /** Scrolls, and lifts content above the keyboard. Use on any screen with an input. */
  scroll?: boolean;
  /**
   * Which safe-area edges to inset.
   *
   * Defaults to top and bottom. A live room passes `[]` so video reaches the
   * notch, and draws its own chrome inside the inset instead.
   */
  edges?: readonly Edge[];
  style?: ViewStyle;
  testID?: string;
}

/**
 * The page container. Every route's outermost element.
 *
 * Centralising the background, the safe-area insets and the keyboard behaviour
 * means a screen author never has to think about any of them — and no screen
 * ends up with a different background than the one beside it.
 */
export function Screen({
  children,
  padded = true,
  scroll = false,
  edges = ['top', 'bottom'],
  style,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  /**
   * Inset and padding COMBINED into longhand, deliberately.
   *
   * The first version layered `{paddingLeft: 0, paddingRight: 0}` from the inset
   * and then `{paddingHorizontal: 16}` from the padding, expecting the later
   * entry to win. It does not: React Native resolves the LONGHAND over the
   * shorthand regardless of array order, so `paddingLeft: 0` beat
   * `paddingHorizontal` and every padded screen rendered flush to both edges.
   *
   * Adding the two together in one object removes the hazard entirely — there
   * is no shorthand left to lose — and it is also more correct on a landscape
   * notch, where the gutter should sit BESIDE the inset rather than inside it.
   */
  const gutter = padded ? spacing.lg : 0;

  const frame: ViewStyle = {
    paddingTop: (edges.includes('top') ? insets.top : 0) + gutter,
    paddingBottom: (edges.includes('bottom') ? insets.bottom : 0) + gutter,
    paddingLeft: (edges.includes('left') ? insets.left : 0) + gutter,
    paddingRight: (edges.includes('right') ? insets.right : 0) + gutter,
  };

  if (scroll) {
    return (
      <KeyboardAwareScrollView
        style={styles.base}
        contentContainerStyle={[frame, style]}
        testID={testID}
        keyboardShouldPersistTaps="handled"
        bottomOffset={spacing.xl}
      >
        {children}
      </KeyboardAwareScrollView>
    );
  }

  return (
    <View style={[styles.base, frame, style]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { flex: 1, backgroundColor: colors.bg.base },
});
