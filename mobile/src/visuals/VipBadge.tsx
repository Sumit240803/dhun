import { StyleSheet, View } from 'react-native';

import type { VipBadge as Tier } from '@/api/types';
import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui';

const TIERS: readonly Tier[] = ['silver', 'gold', 'platinum', 'diamond'];

/** The VIP mark beside a name. Its colour is the tier's and nothing else's. */
export function VipBadge({ tier, size = 'md' }: { tier: string; size?: 'sm' | 'md' }) {
  const known = (TIERS as readonly string[]).includes(tier) ? (tier as Tier) : null;
  if (!known) return null;
  return (
    <View
      style={[styles.badge, size === 'sm' && styles.small, { backgroundColor: colors.vip[known] }]}
      accessibilityLabel={`VIP ${known}`}
      testID={`vip-${known}`}
    >
      <Text variant="micro" tone="onBrand" style={styles.label}>
        VIP
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { paddingHorizontal: 3 },
  label: { fontSize: 8, lineHeight: 10, fontWeight: '800', letterSpacing: 0.4 },
});
