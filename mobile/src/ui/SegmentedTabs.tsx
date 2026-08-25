import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui/Text';

export interface SegmentedTabsOption<T extends string> {
  value: T;
  /** Already-translated. */
  label: string;
  /** Small count beside the label — unread, or how many are live. */
  badge?: number;
}

export interface SegmentedTabsProps<T extends string> {
  options: SegmentedTabsOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /**
   * `underline` for a page's primary sections — the selected one grows and
   * gains a rule beneath it. `pill` for filters within a page.
   */
  variant?: 'underline' | 'pill';
  testID?: string;
}

/**
 * The row of sections at the top of a page.
 *
 * Scrolls horizontally rather than compressing: five sections at a readable
 * size beats seven at an unreadable one, and a partially visible last item is
 * itself the affordance that says there is more.
 */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  variant = 'underline',
  testID,
}: SegmentedTabsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={variant === 'underline' ? styles.underlineRow : styles.pillRow}
      testID={testID}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={variant === 'pill' ? [styles.pill, selected && styles.pillSelected] : undefined}
          >
            <View style={styles.item}>
              <Text
                // Size AND weight change, not just colour: on a cheap screen in
                // a bright room, a colour-only selection is unreadable.
                variant={variant === 'underline' && selected ? 'heading' : 'bodyStrong'}
                tone={selected ? (variant === 'pill' ? 'onBrand' : 'primary') : 'faint'}
              >
                {option.label}
              </Text>
              {option.badge !== undefined && option.badge > 0 && (
                <View style={styles.badge}>
                  <Text variant="micro" tone="onMedia">
                    {option.badge > 99 ? '99+' : String(option.badge)}
                  </Text>
                </View>
              )}
            </View>

            {variant === 'underline' && selected && (
              <Animated.View layout={LinearTransition.duration(180)} style={styles.underline} />
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  underlineRow: { gap: spacing.lg, paddingHorizontal: spacing.lg, alignItems: 'flex-end' },
  pillRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  underline: {
    height: 3,
    width: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.solid,
    alignSelf: 'center',
    marginTop: spacing.xs,
  },
  pill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.raised,
  },
  pillSelected: { backgroundColor: colors.brand.solid },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.status.live,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
