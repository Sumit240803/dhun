import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing, type TierKey } from '@/theme';
import { Text } from '@/ui/Text';

type Tone =
  'neutral' | 'brand' | 'live' | 'success' | 'warning' | 'danger' | 'coin' | 'gem' | 'point';

export interface BadgeProps {
  label: string;
  tone?: Tone;
  /** Overrides `tone` with the gift tier palette. */
  tier?: TierKey;
  testID?: string;
}

const tones: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: colors.bg.raised, fg: colors.text.secondary },
  brand: { bg: colors.brand.soft, fg: colors.brand.onDark },
  live: { bg: colors.status.live, fg: colors.text.onMedia },
  success: { bg: colors.currency.pointSoft, fg: colors.status.success },
  warning: { bg: colors.glass.fill, fg: colors.status.warning },
  danger: { bg: colors.glass.fill, fg: colors.status.danger },
  // The currency badges reuse the reserved currency colours deliberately: a
  // balance chip must read as coins or gems without the user parsing the label.
  coin: { bg: colors.currency.coinSoft, fg: colors.currency.coin },
  gem: { bg: colors.currency.gemSoft, fg: colors.currency.gem },
  point: { bg: colors.currency.pointSoft, fg: colors.currency.point },
};

export function Badge({ label, tone = 'neutral', tier, testID }: BadgeProps) {
  const palette =
    tier !== undefined ? { bg: colors.glass.fill, fg: colors.tier[tier] } : tones[tone];

  return (
    <View testID={testID} style={[styles.base, { backgroundColor: palette.bg }]}>
      <Text variant="micro" style={{ color: palette.fg }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
});
