import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { RewardsStatus } from '@/api/types';
import { useTranslation } from '@/i18n';
import { formatCompact } from '@/lib/money';
import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui';
import { ladderDays } from './schedule';

/**
 * The seven days of the check-in streak.
 *
 * Every day's amount is visible up front. The ladder works because day 7 is
 * worth seven times day 1 and the user can SEE that — hiding what tomorrow pays
 * would remove the only reason to come back tomorrow.
 */
export function CheckinLadder({ checkin }: { checkin: RewardsStatus['checkin'] }) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      {ladderDays(checkin).map(({ day, coins, state }) => (
        <View
          key={day}
          accessible
          accessibilityLabel={t('rewards.dayLabel', { day, coins })}
          accessibilityState={{ selected: state === 'today', checked: state === 'claimed' }}
          style={[
            styles.day,
            state === 'claimed' && styles.claimed,
            state === 'today' && styles.today,
            // The last day is the one the whole week builds towards.
            day === 7 && state !== 'claimed' && styles.big,
          ]}
        >
          <Text variant="micro" tone={state === 'today' ? 'brand' : 'faint'}>
            {t('rewards.dayShort', { day })}
          </Text>
          {state === 'claimed' ? (
            <Animated.View entering={FadeIn.duration(200)}>
              <Ionicons name="checkmark-circle" size={20} color={colors.status.success} />
            </Animated.View>
          ) : (
            <Ionicons
              name="ellipse"
              size={day === 7 ? 18 : 14}
              color={state === 'today' ? colors.currency.coin : colors.border.strong}
            />
          )}
          <Text variant="micro" style={state === 'upcoming' ? styles.upcomingCoins : styles.coins}>
            {formatCompact(coins)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  day: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  claimed: { backgroundColor: colors.status.successSoft, borderColor: 'transparent' },
  today: {
    borderColor: colors.currency.coin,
    borderWidth: 1.5,
    backgroundColor: colors.currency.coinSoft,
  },
  big: { borderStyle: 'dashed' },
  coins: { color: colors.currency.coin, fontWeight: '700' },
  upcomingCoins: { color: colors.text.faint },
});
