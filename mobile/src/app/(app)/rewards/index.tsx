import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useClaimWelcome, useEnterReferralCode, useRewards } from '@/api/queries/useGrowth';
import { ApiError } from '@/api/client';
import { ApiErrorCode } from '@/api/types';
import { CheckinCard } from '@/features/rewards/CheckinCard';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins, formatRupees } from '@/lib/money';
import { coins, paise } from '@/lib/units';
import { useIsRegistered } from '@/store/session';
import { colors, radius, spacing } from '@/theme';
import { Banner, Button, Card, Column, EmptyState, Input, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * Free coins, in one place.
 *
 * Every card states the rule plainly — how much, how often, what triggers it —
 * because a reward whose terms are vague reads as a trick, and the referral
 * one in particular pays only on a friend's real purchase, which must be said
 * before someone invites twenty people expecting a payout.
 */
export default function RewardsScreen() {
  const { t } = useTranslation();
  const isRegistered = useIsRegistered();
  const rewards = useRewards(isRegistered);

  return (
    <Screen padded={false} edges={['top', 'bottom']}>
      <Row style={styles.header} gap="md">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={spacing.md}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
        </Pressable>
        <Text variant="heading">{t('rewards.title')}</Text>
      </Row>

      {!isRegistered ? (
        <View style={styles.centre}>
          <EmptyState
            icon="gift-outline"
            title={t('rewards.guestTitle')}
            body={t('rewards.guestBody')}
            actionLabel={t('room.guestAction')}
            onAction={() => {
              haptic.tap();
              router.push('/(auth)');
            }}
          />
        </View>
      ) : rewards.isError ? (
        <View style={styles.gutter}>
          <Banner message={errorMessage(rewards.error)} onRetry={() => void rewards.refetch()} />
        </View>
      ) : rewards.data === undefined ? (
        <Column gap="lg" style={styles.gutter}>
          <Skeleton height={160} rounding="lg" />
          <Skeleton height={96} rounding="lg" />
          <Skeleton height={180} rounding="lg" />
        </Column>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {rewards.data.welcome.available && (
            <WelcomeCard coinsAmount={rewards.data.welcome.coins} />
          )}
          <CheckinCard checkin={rewards.data.checkin} />
          <WatchCard watch={rewards.data.watch} />
          <InviteCard referral={rewards.data.referral} />
        </ScrollView>
      )}
    </Screen>
  );
}

function WelcomeCard({ coinsAmount }: { coinsAmount: number }) {
  const { t } = useTranslation();
  const claim = useClaimWelcome();

  return (
    <Animated.View entering={FadeInDown.duration(240)}>
      <Card>
        <Column gap="md">
          <Row gap="md">
            <Ionicons name="sparkles" size={24} color={colors.currency.coin} />
            <Column gap="xs" flex={1}>
              <Text variant="heading">
                {t('rewards.welcomeTitle', { coins: formatCoins(coins(coinsAmount)) })}
              </Text>
              <Text variant="caption" tone="secondary">
                {t('rewards.welcomeBody')}
              </Text>
            </Column>
          </Row>
          {claim.error != null && <Banner message={errorMessage(claim.error)} />}
          <Button
            label={t('rewards.claim')}
            onPress={() => {
              haptic.tap();
              claim.mutate(undefined, {
                onSuccess: () => haptic.success(),
                onError: () => haptic.error(),
              });
            }}
            loading={claim.isPending}
            fullWidth
            testID="claim-welcome"
          />
        </Column>
      </Card>
    </Animated.View>
  );
}

function WatchCard({
  watch,
}: {
  watch: { coins: number; minutes: number; dailyCap: number; earnedToday: number };
}) {
  const { t } = useTranslation();
  const progress = watch.dailyCap === 0 ? 1 : Math.min(1, watch.earnedToday / watch.dailyCap);
  const done = watch.earnedToday >= watch.dailyCap;

  return (
    <Animated.View entering={FadeInDown.duration(240).delay(80)}>
      <Card>
        <Column gap="md">
          <Row gap="md">
            <Ionicons name="headset" size={22} color={colors.brand.accent} />
            <Column gap="xs" flex={1}>
              <Text variant="heading">{t('rewards.watchTitle')}</Text>
              <Text variant="caption" tone="secondary">
                {t('rewards.watchBody', {
                  coins: formatCoins(coins(watch.coins)),
                  minutes: watch.minutes,
                })}
              </Text>
            </Column>
          </Row>

          <View
            style={styles.track}
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: watch.dailyCap, now: watch.earnedToday }}
          >
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
          <Text variant="caption" tone={done ? 'secondary' : 'primary'}>
            {done
              ? t('rewards.watchDone')
              : t('rewards.watchProgress', { earned: watch.earnedToday, cap: watch.dailyCap })}
          </Text>

          {!done && (
            <Button
              label={t('rewards.watchAction')}
              onPress={() => {
                haptic.tap();
                router.navigate('/(app)/(tabs)');
              }}
              variant="secondary"
              fullWidth
            />
          )}
        </Column>
      </Card>
    </Animated.View>
  );
}

function InviteCard({
  referral,
}: {
  referral: {
    code: string;
    coins: number;
    minPurchasePaise: number;
    invited: number;
    rewarded: number;
    canEnterCode: boolean;
    referredBy: string | null;
  };
}) {
  const { t } = useTranslation();
  const enter = useEnterReferralCode();
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(referral.code);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  async function share() {
    haptic.tap();
    await Share.share({ message: t('rewards.shareMessage', { code: referral.code }) }).catch(
      () => undefined,
    );
  }

  const codeError =
    enter.error instanceof ApiError
      ? enter.error.code === ApiErrorCode.REFERRAL_CODE_INVALID
        ? t('rewards.codeInvalid')
        : errorMessage(enter.error)
      : undefined;

  return (
    <Animated.View entering={FadeInDown.duration(240).delay(120)}>
      <Card>
        <Column gap="md">
          <Column gap="xs">
            <Text variant="heading">{t('rewards.inviteTitle')}</Text>
            <Text variant="caption" tone="secondary">
              {t('rewards.inviteBody', {
                coins: formatCoins(coins(referral.coins)),
                amount: formatRupees(paise(referral.minPurchasePaise)),
              })}
            </Text>
          </Column>

          <Row justify="between" style={styles.codeBox}>
            <Column gap="xs">
              <Text variant="micro" tone="faint">
                {t('rewards.yourCode')}
              </Text>
              <Text variant="title" selectable>
                {referral.code}
              </Text>
            </Column>
            <Button
              label={copied ? t('rewards.copied') : t('rewards.copy')}
              onPress={() => void copy()}
              variant="ghost"
              size="sm"
            />
          </Row>

          <Button
            label={t('rewards.share')}
            onPress={() => void share()}
            fullWidth
            testID="share-invite"
          />

          {(referral.invited > 0 || referral.rewarded > 0) && (
            <Text variant="caption" tone="secondary">
              {t('rewards.inviteStats', { invited: referral.invited, rewarded: referral.rewarded })}
            </Text>
          )}

          {referral.referredBy !== null ? (
            <Text variant="caption" tone="secondary">
              {t('rewards.invitedBy', { name: referral.referredBy })}
            </Text>
          ) : (
            referral.canEnterCode && (
              <Column gap="sm">
                <Input
                  label={t('rewards.enterCodeLabel')}
                  value={code}
                  onChangeText={(next) => setCode(next.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  maxLength={18}
                  error={codeError}
                  testID="referral-code"
                />
                <Button
                  label={t('rewards.applyCode')}
                  onPress={() => {
                    haptic.tap();
                    enter.mutate(code, {
                      onSuccess: () => haptic.success(),
                      onError: () => haptic.error(),
                    });
                  }}
                  disabled={code.length < 5}
                  loading={enter.isPending}
                  variant="secondary"
                  fullWidth
                />
              </Column>
            )
          )}
        </Column>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { height: 52, paddingHorizontal: spacing.lg },
  gutter: { paddingHorizontal: spacing.lg },
  centre: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.raised,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.brand.accent },
  codeBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border.strong,
  },
});
