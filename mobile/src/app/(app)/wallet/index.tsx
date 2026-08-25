import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useCoinPacks, useWallet } from '@/api/queries/useWallet';
import type { CoinPack } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins, formatGems, formatRupees } from '@/lib/money';
import { coins, gems, paise } from '@/lib/units';
import { colors, radius, spacing } from '@/theme';
import { Banner, Button, Checkbox, Column, Row, Screen, Skeleton, Text } from '@/ui';

export default function TopUpScreen() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const packs = useCoinPacks();

  const [selected, setSelected] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  const pack = (packs.data ?? []).find((candidate) => candidate.id === selected) ?? null;

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
        <Text variant="heading" style={styles.title}>
          {t('topUp.title')}
        </Text>
        <View style={styles.headerSpacer} />
      </Row>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(300)}>
          <LinearGradient
            colors={[colors.currency.coin, colors.status.warning]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.balanceCard}
          >
            <Row justify="between">
              <Column gap="xs">
                {wallet.data === undefined ? (
                  <Skeleton width={90} height={34} />
                ) : (
                  <Text variant="display" tone="onBrand">
                    {formatCoins(coins(wallet.data.coins))}
                  </Text>
                )}
                <Text variant="caption" tone="onBrand">
                  {t('topUp.remaining')}
                </Text>
              </Column>

              <Link href="/(app)/wallet/transactions" asChild>
                <Pressable accessibilityRole="button" style={styles.detailsButton}>
                  <Text variant="caption" style={styles.detailsText}>
                    {t('topUp.details')}
                  </Text>
                </Pressable>
              </Link>
            </Row>
          </LinearGradient>
        </Animated.View>

        {packs.isError && (
          <View style={styles.gutter}>
            <Banner message={errorMessage(packs.error)} onRetry={() => void packs.refetch()} />
          </View>
        )}

        <View style={styles.gutter}>
          <Text variant="micro" tone="faint">
            {t('topUp.payWith').toUpperCase()}
          </Text>
          <View style={styles.method}>
            <Ionicons name="logo-google" size={18} color={colors.text.primary} />
            <Text variant="bodyStrong">Play</Text>
          </View>
        </View>

        <View style={styles.grid}>
          {packs.isLoading
            ? Array.from({ length: 6 }, (_, index) => (
                <View key={index} style={styles.cell}>
                  <Skeleton height={92} rounding="lg" />
                </View>
              ))
            : (packs.data ?? []).map((candidate) => (
                <View key={candidate.id} style={styles.cell}>
                  <PackTile
                    pack={candidate}
                    selected={candidate.id === selected}
                    starterLabel={t('topUp.starterBadge')}
                    bonusLabel={t('topUp.bonusGems', { gems: formatGems(gems(candidate.gems)) })}
                    onPress={() => {
                      haptic.selection();
                      setSelected(candidate.id);
                    }}
                  />
                </View>
              ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Checkbox
          checked={agreed}
          onChange={(next) => {
            haptic.selection();
            setAgreed(next);
          }}
          accessibilityLabel={t('topUp.agreement', { terms: t('topUp.agreementLink') })}
          testID="recharge-consent"
        >
          <AgreementLabel />
        </Checkbox>

        <Button
          label={t('topUp.recharge')}
          onPress={() => {
            haptic.tap();
            // TODO(M4): IAP purchase flow. The endpoint exists
            // (POST /v1/wallet/purchase/iap) and takes an Idempotency-Key
            // generated once here and reused for every retry of this intent.
          }}
          disabled={pack === null || !agreed}
          size="lg"
          fullWidth
          testID="recharge"
        />

        {pack === null && (
          <Text variant="micro" tone="faint" style={styles.hint}>
            {t('topUp.selectPack')}
          </Text>
        )}
      </View>
    </Screen>
  );
}

function PackTile({
  pack,
  selected,
  starterLabel,
  bonusLabel,
  onPress,
}: {
  pack: CoinPack;
  selected: boolean;
  starterLabel: string;
  bonusLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${formatCoins(coins(pack.coins))} coins, ${formatRupees(paise(pack.pricePaise))}`}
      style={({ pressed }) => [
        styles.tile,
        selected && styles.tileSelected,
        pressed && styles.tilePressed,
      ]}
      testID={`pack-${pack.id}`}
    >
      {pack.lifetimeOnce && (
        <View style={styles.starter}>
          <Text variant="micro" tone="onMedia" numberOfLines={1}>
            {starterLabel}
          </Text>
        </View>
      )}
      <Text variant="bodyStrong" numberOfLines={1}>
        {formatCoins(coins(pack.coins))}
      </Text>
      {pack.gems > 0 && (
        <Text variant="micro" style={styles.bonus} numberOfLines={1}>
          {bonusLabel}
        </Text>
      )}
      <Text variant="caption" tone="secondary">
        {formatRupees(paise(pack.pricePaise))}
      </Text>
    </Pressable>
  );
}

/**
 * "I have read and agree to the Recharge Agreement."
 *
 * One translated sentence with a placeholder, split at render — Hindi puts the
 * verb last, so a concatenated version cannot be reordered correctly.
 */
function AgreementLabel() {
  const { t } = useTranslation();
  const parts = t('topUp.agreement').split(/(\{terms\})/);

  return (
    <Text variant="micro" tone="faint" style={styles.agreement}>
      {parts.map((part, index) =>
        part === '{terms}' ? (
          <Link key={index} href="/legal/terms" style={styles.link}>
            {t('topUp.agreementLink')}
          </Link>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, height: 52 },
  title: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 26 },
  scroll: { paddingBottom: spacing.xl, gap: spacing.lg },
  balanceCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    padding: spacing.xl,
    minHeight: 120,
    justifyContent: 'center',
  },
  detailsButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.surface,
    alignSelf: 'flex-start',
  },
  detailsText: { color: colors.currency.coin },
  gutter: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand.solid,
    backgroundColor: colors.bg.surface,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg - spacing.xs },
  cell: { width: '33.33%', padding: spacing.xs },
  tile: {
    minHeight: 92,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    overflow: 'hidden',
  },
  tileSelected: { borderColor: colors.brand.solid, backgroundColor: colors.brand.soft },
  tilePressed: { backgroundColor: colors.bg.pressed },
  starter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingVertical: 2,
    alignItems: 'center',
    backgroundColor: colors.brand.solid,
  },
  bonus: { color: colors.currency.gem },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  agreement: { lineHeight: 16 },
  link: { color: colors.brand.accent, textDecorationLine: 'underline' },
  hint: { textAlign: 'center' },
});
