import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

/**
 * Marks a route that exists in the navigation tree but is not built yet.
 *
 * The routes are created up front so the structure is real and navigable — a
 * skeleton you can tap through beats a diagram. Each one names the milestone
 * that fills it in, so nothing gets silently forgotten.
 */
export function Placeholder({ title, milestone }: { title: string; milestone: string }) {
  return (
    <View style={styles.container}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{milestone}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Not built yet — see docs/build-plan.md</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.base,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  badge: {
    backgroundColor: colors.brand.soft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  badgeText: { ...typography.micro, color: colors.brand.solid },
  title: { ...typography.title, color: colors.text.primary, textAlign: 'center' },
  subtitle: { ...typography.caption, color: colors.text.faint, textAlign: 'center' },
});
