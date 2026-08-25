import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** What to do next. An empty state without this is just a blank screen with a caption. */
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}

/**
 * A list with nothing in it.
 *
 * The rule: never state the absence without stating the remedy. "No one you
 * follow is live" is a dead end; adding "Explore has 200 rooms right now" and a
 * button is the difference between a user leaving and a user tapping.
 */
export function EmptyState({ icon, title, body, actionLabel, onAction, testID }: EmptyStateProps) {
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.container} testID={testID}>
      <View style={styles.badge}>
        <Ionicons name={icon} size={26} color={colors.brand.accent} />
      </View>
      <Text variant="heading" style={styles.centred}>
        {title}
      </Text>
      <Text variant="body" tone="secondary" style={styles.centred}>
        {body}
      </Text>
      {actionLabel !== undefined && onAction !== undefined && (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} size="sm" />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.soft,
    marginBottom: spacing.sm,
  },
  centred: { textAlign: 'center' },
  action: { marginTop: spacing.md },
});
