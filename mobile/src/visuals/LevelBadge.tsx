import { StyleSheet, View } from 'react-native';

import { Text } from '@/ui/Text';
import { colors, radius, spacing } from '@/theme';

/**
 * WORKED EXAMPLE for `visuals/`.
 *
 * The distinguishing property of this layer: everything renders from SERVER
 * data, and degrades rather than throwing. A level badge is the simplest case —
 * no asset to load — but it establishes the shape the gift and frame components
 * follow.
 *
 * User levels run 1–70 on lifetime purchased coins; host levels 1–60 on
 * cumulative points earned. Both are derived server-side from `level_thresholds`,
 * so the client never computes a level — it only draws the number it is given.
 */

export interface LevelBadgeProps {
  level: number;
  kind?: 'user' | 'host';
  size?: 'sm' | 'md';
}

/**
 * Colour band by level, reusing the gift-tier scale.
 *
 * Deliberately the same ramp as gifts: grey → blue → purple → orange → gold. A
 * user learns the hierarchy once and it reads the same everywhere, which is worth
 * more than giving levels their own palette.
 */
function bandFor(level: number): string {
  if (level >= 51) return colors.tier[5];
  if (level >= 31) return colors.tier[4];
  if (level >= 16) return colors.tier[3];
  if (level >= 6) return colors.tier[2];
  return colors.tier[1];
}

export function LevelBadge({ level, kind = 'user', size = 'md' }: LevelBadgeProps) {
  // Never crash on bad data. A malformed level from an older API version must
  // render *something* — this component appears beside every username in a room,
  // so a throw here would take down the whole message list.
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.trunc(level)) : 1;
  const band = bandFor(safeLevel);

  return (
    <View
      style={[styles.badge, size === 'sm' && styles.badgeSmall, { backgroundColor: band }]}
      accessibilityLabel={`${kind === 'host' ? 'Host' : 'User'} level ${safeLevel}`}
    >
      <Text variant="micro" tone="inverse" style={styles.label}>
        {kind === 'host' ? 'H' : 'L'}
        {safeLevel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeSmall: { paddingHorizontal: spacing.xs },
  label: { letterSpacing: 0.3 },
});
