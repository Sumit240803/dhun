import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useTransactions } from '@/api/queries/useWallet';
import type { WalletTransaction } from '@/api/types';
import { useTranslation, type MessageKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins, formatGems, formatPoints } from '@/lib/money';
import { istDate } from '@/lib/preferences';
import { coins, gems, points } from '@/lib/units';
import { colors, radius, spacing } from '@/theme';
import { Banner, Button, Column, EmptyState, Row, Screen, Skeleton, Text } from '@/ui';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Every ledger transaction type a user's own accounts can appear in, with
 * the word for it and the glyph. Anything unlisted is an "adjustment" — the
 * ledger will grow types before this list does, and a row that says
 * "adjustment" beats one that says `vip_refund`.
 */
const TYPES: Record<string, { label: MessageKey; icon: IconName }> = {
  gift_send: { label: 'txns.giftSend', icon: 'gift' },
  purchase_iap: { label: 'txns.purchase', icon: 'card' },
  purchase_web: { label: 'txns.purchaseWeb', icon: 'globe' },
  purchase_reseller: { label: 'txns.fromAgency', icon: 'people' },
  free_coin_grant: { label: 'txns.freeCoins', icon: 'sparkles' },
  coin_to_gem_conversion: { label: 'txns.converted', icon: 'swap-horizontal' },
  cosmetic_purchase: { label: 'txns.storePurchase', icon: 'color-palette' },
  cosmetic_grant: { label: 'txns.levelReward', icon: 'ribbon' },
  promo_grant: { label: 'txns.bonus', icon: 'sparkles' },
  host_referral_bonus: { label: 'txns.referralBonus', icon: 'person-add' },
  points_hold_release: { label: 'txns.pointsReleased', icon: 'lock-open' },
  payout_request: { label: 'txns.payoutRequested', icon: 'cash' },
  payout_settled: { label: 'txns.payoutPaid', icon: 'checkmark-done' },
  agency_commission_accrual: { label: 'txns.commission', icon: 'briefcase' },
  agency_commission_payout: { label: 'txns.commissionPaid', icon: 'briefcase' },
  vip_purchase: { label: 'txns.vip', icon: 'star' },
  vip_renewal: { label: 'txns.vipRenewed', icon: 'star' },
  vip_refund: { label: 'txns.vipRefund', icon: 'star-outline' },
  room_entry_fee: { label: 'txns.roomEntry', icon: 'enter' },
};

const FALLBACK: { label: MessageKey; icon: IconName } = {
  label: 'txns.adjustment',
  icon: 'ellipsis-horizontal-circle',
};

type ListRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'txn'; key: string; txn: WalletTransaction };

/**
 * The statement.
 *
 * Grouped by IST day, newest first, one row per ledger transaction with every
 * balance it moved. Three currencies can appear on one row — a conversion
 * takes coins and gives gems — so each is drawn in its reserved colour, and
 * a row never collapses them into one number.
 */
export default function TransactionsScreen() {
  const { t, locale } = useTranslation();
  const query = useTransactions();
  // Read once per mount: "today" must not shift under a list mid-scroll.
  const [now] = useState(() => Date.now());

  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    let lastDay = '';
    const today = istDate(now);
    const yesterday = istDate(now - 86_400_000);
    for (const txn of query.data?.pages.flat() ?? []) {
      const day = istDate(Date.parse(txn.createdAt));
      if (day !== lastDay) {
        lastDay = day;
        out.push({
          kind: 'day',
          key: `day-${day}`,
          label:
            day === today
              ? t('txns.today')
              : day === yesterday
                ? t('txns.yesterday')
                : new Date(`${day}T00:00:00+05:30`).toLocaleDateString(
                    locale === 'hi' ? 'hi-IN' : 'en-IN',
                    { day: 'numeric', month: 'long' },
                  ),
        });
      }
      out.push({ kind: 'txn', key: txn.id, txn });
    }
    return out;
  }, [query.data, t, locale, now]);

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
        <Text variant="heading">{t('txns.title')}</Text>
      </Row>

      {query.isError ? (
        <View style={styles.gutter}>
          <Banner message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </View>
      ) : query.data === undefined ? (
        <Column gap="md" style={styles.gutter}>
          <Skeleton width={80} height={12} />
          {Array.from({ length: 6 }, (_, index) => (
            <Row key={index} gap="md">
              <Skeleton width={40} height={40} rounding="pill" />
              <Column gap="xs" flex={1}>
                <Skeleton width={140} height={14} />
                <Skeleton width={60} height={10} />
              </Column>
              <Skeleton width={70} height={14} />
            </Row>
          ))}
        </Column>
      ) : rows.length === 0 ? (
        <View style={styles.centre}>
          <EmptyState
            icon="receipt-outline"
            title={t('txns.emptyTitle')}
            body={t('txns.emptyBody')}
            actionLabel={t('wallet.buyCoins')}
            onAction={() => {
              haptic.tap();
              router.back();
            }}
            testID="txns-empty"
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          renderItem={({ item }) =>
            item.kind === 'day' ? (
              <Text variant="micro" tone="faint" style={styles.day}>
                {item.label.toUpperCase()}
              </Text>
            ) : (
              <TransactionRow txn={item.txn} />
            )
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <View style={styles.footer}>
                <Skeleton width={120} height={12} />
              </View>
            ) : query.hasNextPage ? (
              <View style={styles.footer}>
                <Button
                  label={t('txns.loadMore')}
                  onPress={() => void query.fetchNextPage()}
                  variant="ghost"
                  size="sm"
                />
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

function TransactionRow({ txn }: { txn: WalletTransaction }) {
  const { t, locale } = useTranslation();
  const meta = TYPES[txn.type] ?? FALLBACK;
  const time = new Date(txn.createdAt).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.row} testID={`txn-${txn.id}`}>
      <View style={styles.disc}>
        <Ionicons name={meta.icon} size={18} color={colors.text.secondary} />
      </View>
      <Column gap="xs" flex={1}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {t(meta.label)}
        </Text>
        <Text variant="micro" tone="faint">
          {time}
        </Text>
      </Column>
      <Column align="end" gap="xs">
        {txn.coins !== 0 && (
          <Amount
            value={txn.coins}
            text={formatCoins(coins(Math.abs(txn.coins)))}
            tint={colors.currency.coin}
          />
        )}
        {txn.gems !== 0 && (
          <Amount
            value={txn.gems}
            text={formatGems(gems(Math.abs(txn.gems)))}
            tint={colors.currency.gem}
          />
        )}
        {txn.points !== 0 && (
          <Amount
            value={txn.points}
            text={formatPoints(points(Math.abs(txn.points)))}
            tint={colors.currency.point}
          />
        )}
      </Column>
    </Animated.View>
  );
}

/** One signed balance movement. Money gained carries its currency colour; money spent is quieter. */
function Amount({ value, text, tint }: { value: number; text: string; tint: string }) {
  const gained = value > 0;
  return (
    <Text
      variant="bodyStrong"
      style={[styles.amount, { color: gained ? tint : colors.text.secondary }]}
    >
      {gained ? '+' : '−'}
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  gutter: { paddingHorizontal: spacing.lg },
  centre: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  day: {
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
  },
  disc: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
  },
  amount: { fontVariant: ['tabular-nums'] },
  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
});
