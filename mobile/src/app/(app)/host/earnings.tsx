import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useHostEarnings } from '@/api/queries/useEarnings';
import type { HostEarnings } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatCoins, formatCompact, formatPoints } from '@/lib/money';
import { coins, points } from '@/lib/units';
import { colors, radius, spacing } from '@/theme';
import { Avatar, Banner, Card, Column, Divider, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * The host's earnings — Phase 0's "earnings dashboard" (app-blueprint-v1).
 *
 * Points first and large, because that is the number a host opens this for.
 * Then the last thirty days as bars, four facts about the month, and who gave
 * the most — the people a host should know by name. Every figure is read from
 * the ledger and from gifts already sent; nothing is a counter.
 *
 * No withdraw button. Withdrawal is M8's payout pipeline (CA, RazorpayX), and
 * a button that cannot work yet is worse than none. The screen says where the
 * points stand instead.
 */
export default function EarningsScreen() {
  const { t, locale } = useTranslation();
  const earnings = useHostEarnings();

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
        <Text variant="heading">{t('earnings.title')}</Text>
      </Row>

      {earnings.isError ? (
        <View style={styles.gutter}>
          <Banner message={errorMessage(earnings.error)} onRetry={() => void earnings.refetch()} />
        </View>
      ) : earnings.data === undefined ? (
        <Column gap="lg" style={styles.gutter}>
          <Skeleton height={132} rounding="lg" />
          <Skeleton height={140} rounding="lg" />
          <Skeleton height={96} rounding="lg" />
        </Column>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.duration(260)}>
            <View style={styles.hero}>
              <Row gap="xs" align="center">
                <Ionicons name="cash" size={14} color={colors.currency.point} />
                <Text variant="micro" tone="secondary">
                  {t('earnings.balance')}
                </Text>
              </Row>
              <Text variant="display" style={styles.balance} testID="earnings-balance">
                {formatPoints(points(earnings.data.pointsBalance))}
              </Text>
              <Text variant="caption" tone="secondary">
                {t('earnings.balanceHint')}
              </Text>
              {(earnings.data.points.withdrawable > 0 ||
                earnings.data.points.pendingPayout > 0) && (
                <Row gap="lg" style={styles.split}>
                  <Fact
                    label={t('earnings.held')}
                    value={formatPoints(points(earnings.data.points.held))}
                  />
                  <Fact
                    label={t('earnings.ready')}
                    value={formatPoints(points(earnings.data.points.withdrawable))}
                  />
                </Row>
              )}
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(260).delay(50)}>
            <Card>
              <Column gap="md">
                <Row justify="between" align="center">
                  <Text variant="heading">{t('earnings.last30')}</Text>
                  <Text variant="caption" tone="secondary">
                    {t('earnings.pointsCount', {
                      points: formatPoints(points(earnings.data.window.points)),
                    })}
                  </Text>
                </Row>
                <DailyBars days={earnings.data.daily} locale={locale} />
                <Divider />
                <Row>
                  <Stat
                    label={t('earnings.gifts')}
                    value={formatCompact(earnings.data.window.gifts)}
                  />
                  <Stat
                    label={t('earnings.coins')}
                    value={formatCompact(earnings.data.window.coins)}
                  />
                  <Stat
                    label={t('earnings.hours')}
                    value={earnings.data.window.hoursLive.toLocaleString(
                      locale === 'hi' ? 'hi-IN' : 'en-IN',
                      {
                        maximumFractionDigits: 1,
                      },
                    )}
                  />
                  <Stat label={t('earnings.rooms')} value={String(earnings.data.window.rooms)} />
                </Row>
              </Column>
            </Card>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(260).delay(100)}>
            <Card padded={false}>
              <View style={styles.cardHead}>
                <Text variant="heading">{t('earnings.topGifters')}</Text>
              </View>
              {earnings.data.topGifters.length === 0 ? (
                <Text variant="caption" tone="secondary" style={styles.empty}>
                  {t('earnings.noGifters')}
                </Text>
              ) : (
                earnings.data.topGifters.map((gifter, index) => (
                  <View key={gifter.userId}>
                    {index > 0 && <Divider />}
                    <Pressable
                      onPress={() =>
                        router.push({ pathname: '/(app)/user/[id]', params: { id: gifter.userId } })
                      }
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.gifter, pressed && styles.pressed]}
                      testID={`gifter-${gifter.userId}`}
                    >
                      <Text variant="bodyStrong" tone="faint" style={styles.rank}>
                        {index + 1}
                      </Text>
                      <Avatar name={gifter.displayName ?? '—'} uri={gifter.avatarUrl} size="sm" />
                      <Column gap="xs" flex={1}>
                        <Text variant="bodyStrong" numberOfLines={1}>
                          {gifter.displayName ?? '—'}
                        </Text>
                        <Text variant="micro" tone="faint">
                          {t('earnings.giftCount', { count: gifter.gifts })}
                        </Text>
                      </Column>
                      <Text variant="bodyStrong" style={styles.coins}>
                        {formatCoins(coins(gifter.coins))}
                      </Text>
                    </Pressable>
                  </View>
                ))
              )}
            </Card>
          </Animated.View>
        </ScrollView>
      )}
    </Screen>
  );
}

/** Thirty thin bars, scaled to the best day. A day with nothing is a hairline. */
function DailyBars({ days, locale }: { days: HostEarnings['daily']; locale: string }) {
  const max = Math.max(1, ...days.map((d) => d.points));
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00+05:30`).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
    });
  return (
    <Column gap="xs">
      <View style={styles.bars} testID="earnings-bars">
        {days.map((d) => (
          <View key={d.day} style={styles.barSlot}>
            <View
              style={[
                styles.bar,
                { height: Math.max(2, Math.round((d.points / max) * 72)) },
                d.points === 0 && styles.barEmpty,
              ]}
            />
          </View>
        ))}
      </View>
      <Row justify="between">
        <Text variant="micro" tone="faint">
          {days[0] ? fmt(days[0].day) : ''}
        </Text>
        <Text variant="micro" tone="faint">
          {days[days.length - 1] ? fmt(days[days.length - 1]!.day) : ''}
        </Text>
      </Row>
    </Column>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Column align="center" gap="xs" flex={1}>
      <Text variant="heading">{value}</Text>
      <Text variant="micro" tone="faint">
        {label}
      </Text>
    </Column>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Column gap="xs">
      <Text variant="micro" tone="faint">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </Column>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  gutter: { paddingHorizontal: spacing.lg },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  hero: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.currency.pointSoft,
    gap: spacing.xs,
  },
  balance: { color: colors.currency.point },
  split: { marginTop: spacing.sm },
  cardHead: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  empty: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  gifter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  rank: { width: 18, textAlign: 'center' },
  coins: { color: colors.currency.coin, fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 72, gap: 2 },
  barSlot: { flex: 1, justifyContent: 'flex-end' },
  bar: { borderRadius: 2, backgroundColor: colors.currency.point },
  barEmpty: { backgroundColor: colors.border.subtle },
});
