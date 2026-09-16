import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { StyleSheet } from 'react-native';

import { useCheckin } from '@/api/queries/useGrowth';
import type { RewardsStatus } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins } from '@/lib/money';
import { coins } from '@/lib/units';
import { colors } from '@/theme';
import { Banner, Button, Card, Column, Text } from '@/ui';
import { CheckinLadder } from './CheckinLadder';

/**
 * Today's check-in: the ladder, and the one button that claims it.
 *
 * Shared by the rewards screen and the once-a-day prompt, so the two can never
 * describe the same streak differently.
 */
export function CheckinCard({
  checkin,
  onClaimed,
}: {
  checkin: RewardsStatus['checkin'];
  /** After a successful claim — the prompt closes itself on this. */
  onClaimed?: () => void;
}) {
  const { t } = useTranslation();
  const claim = useCheckin();
  const todayCoins = checkin.ladder[checkin.streakDay - 1] ?? 0;

  return (
    <Animated.View entering={FadeInDown.duration(240).delay(40)}>
      <Card>
        <Column gap="md">
          <Column gap="xs">
            <Text variant="heading">{t('rewards.checkinTitle')}</Text>
            <Text variant="caption" tone="secondary">
              {checkin.claimedToday
                ? t('rewards.checkinDone', { day: checkin.streakDay })
                : t('rewards.checkinBody')}
            </Text>
          </Column>

          <CheckinLadder checkin={checkin} />

          {claim.error != null && <Banner message={errorMessage(claim.error)} />}
          {claim.data && !claim.data.alreadyClaimed && (
            <Animated.View entering={FadeIn.duration(200)}>
              <Text variant="bodyStrong" style={styles.earned}>
                {t('rewards.earned', { coins: formatCoins(coins(claim.data.coins)) })}
              </Text>
            </Animated.View>
          )}

          <Button
            label={
              checkin.claimedToday
                ? t('rewards.comeBackTomorrow')
                : t('rewards.claimCoins', { coins: formatCoins(coins(todayCoins)) })
            }
            onPress={() => {
              haptic.tap();
              claim.mutate(undefined, {
                onSuccess: () => {
                  haptic.success();
                  onClaimed?.();
                },
                onError: () => haptic.error(),
              });
            }}
            disabled={checkin.claimedToday}
            loading={claim.isPending}
            fullWidth
            testID="claim-checkin"
          />
        </Column>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  earned: { color: colors.currency.coin, textAlign: 'center' },
});
