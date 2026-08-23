import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { t } from '@/i18n';
import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui/Text';

type Tone = 'danger' | 'warning' | 'info';

export interface BannerProps {
  message: string;
  tone?: Tone;
  /** Secondary line — a trace reference, or what to do next. */
  detail?: string;
  /** Shows a retry affordance. Omit when there is nothing to retry. */
  onRetry?: () => void;
  testID?: string;
}

const tones: Record<Tone, { fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  danger: { fg: colors.status.danger, icon: 'alert-circle' },
  warning: { fg: colors.status.warning, icon: 'warning' },
  info: { fg: colors.text.secondary, icon: 'information-circle' },
};

/**
 * A failure the user needs to see but that does not replace the screen.
 *
 * Deliberately inline rather than a toast: an error about the form you are
 * looking at belongs next to the form. Toasts are for things that happened
 * elsewhere, and they disappear before a slow reader finishes the sentence.
 */
export function Banner({ message, tone = 'danger', detail, onRetry, testID }: BannerProps) {
  const palette = tones[tone];

  return (
    <Animated.View
      testID={testID}
      // Announced immediately, because a sighted user sees the banner appear
      // and a screen-reader user otherwise would not.
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      entering={FadeInDown.duration(180)}
      exiting={FadeOut.duration(120)}
      layout={LinearTransition.duration(180)}
      style={styles.container}
    >
      <Ionicons name={palette.icon} size={18} color={palette.fg} style={styles.icon} />
      <View style={styles.body}>
        <Text variant="caption" style={{ color: palette.fg }}>
          {message}
        </Text>
        {detail !== undefined && (
          <Text variant="micro" tone="faint">
            {detail}
          </Text>
        )}
      </View>
      {onRetry !== undefined && (
        <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={spacing.sm}>
          <Text variant="micro" tone="brand">
            {t('common.retry')}
          </Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.glass.fill,
  },
  icon: { marginTop: 1 },
  body: { flex: 1, gap: 2 },
});
