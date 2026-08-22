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
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  const inset: ViewStyle = {
    paddingTop: edges.includes('top') ? insets.top : 0,
    paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
    paddingLeft: edges.includes('left') ? insets.left : 0,
    paddingRight: edges.includes('right') ? insets.right : 0,
  };

  if (scroll) {
    return (
      <KeyboardAwareScrollView
        style={styles.base}
        contentContainerStyle={[inset, padded && styles.padded, style]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={spacing.xl}
      >
        {children}
      </KeyboardAwareScrollView>
    );
  }

  return <View style={[styles.base, inset, padded && styles.padded, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { flex: 1, backgroundColor: colors.bg.base },
  padded: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
});
