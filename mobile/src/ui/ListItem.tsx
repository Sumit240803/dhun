import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';
import { Text } from '@/ui/Text';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  /** Avatar, icon or currency glyph. */
  left?: ReactNode;
  /** A value, a badge, a switch, a chevron. */
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}

/**
 * One row of a settings list, a transaction list, a follower list.
 *
 * Fixed 56pt minimum height regardless of whether a subtitle is present, so a
 * mixed list does not look ragged — and so every row clears the 44pt touch
 * target both platforms require.
 */
export function ListItem({
  title,
  subtitle,
  left,
  right,
  onPress,
  disabled = false,
  testID,
}: ListItemProps) {
  const content = (
    <>
      {left !== undefined && <View>{left}</View>}
      <View style={styles.body}>
        <Text variant="body" tone={disabled ? 'faint' : 'primary'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {right !== undefined && <View>{right}</View>}
    </>
  );

  if (onPress === undefined) {
    return (
      <View style={styles.row} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle === undefined ? title : `${title}. ${subtitle}`}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  body: { flex: 1, gap: 2 },
  pressed: { backgroundColor: colors.bg.pressed },
});
