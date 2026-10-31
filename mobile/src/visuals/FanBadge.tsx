import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing, type TierKey } from '@/theme';
import { Text } from '@/ui';

/** Fan levels 1–7 borrow the gift-tier ramp, two levels per step. */
function tierFor(level: number): TierKey {
  return Math.min(5, Math.max(1, Math.ceil(level / 1.5))) as TierKey;
}

/** "F3" beside a name: how much this person has given THIS host. Nothing for 0. */
export function FanBadge({ level }: { level: number }) {
  if (!Number.isFinite(level) || level <= 0) return null;
  const safe = Math.trunc(level);
  return (
    <View
      style={[styles.badge, { backgroundColor: colors.tier[tierFor(safe)] }]}
      accessibilityLabel={`Fan level ${safe}`}
      testID={`fan-${safe}`}
    >
      <Text variant="micro" tone="inverse" style={styles.label}>
        F{safe}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: spacing.xs, paddingVertical: 1, borderRadius: radius.sm },
  label: { fontSize: 8, lineHeight: 10, fontWeight: '800' },
});
