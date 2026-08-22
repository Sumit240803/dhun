import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';

export interface DividerProps {
  /** Vertical margin above and below. Omit inside a list where rows already have padding. */
  inset?: keyof typeof spacing;
  strong?: boolean;
}

export function Divider({ inset, strong = false }: DividerProps) {
  return (
    <View
      // Decorative: announcing "horizontal rule" between every list row makes a
      // screen reader unusable.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        { backgroundColor: strong ? colors.border.strong : colors.border.subtle },
        inset !== undefined && { marginVertical: spacing[inset] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: { height: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
});
