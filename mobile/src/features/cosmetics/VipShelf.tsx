import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ApiError } from '@/api/client';
import { usePurchaseVip, useVipTiers } from '@/api/queries/useCosmetics';
import { ApiErrorCode, type OwnedCosmetic, type VipPerk, type VipTier } from '@/api/types';
import { useTranslation, type MessageKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { IntentKeys } from '@/lib/intentKeys';
import { formatGems } from '@/lib/money';
import { gems } from '@/lib/units';
import { colors, radius, spacing } from '@/theme';
import { Banner, Button, Column, Row, Sheet, Skeleton, Text, type SheetHandle } from '@/ui';
import { daysLeft } from '@/visuals/look';
import { VipBadge } from '@/visuals/VipBadge';

const PERK_LABEL: Record<VipPerk, MessageKey> = {
  badge: 'store.perkBadge',
  name_color: 'store.perkNameColor',
  bubble: 'store.perkBubble',
  entry: 'store.perkEntry',
  frame: 'store.perkFrame',
  stealth: 'store.perkStealth',
  global_badge: 'store.perkGlobalBadge',
  priority_mic: 'store.perkPriorityMic',
};

interface Props {
  owned: readonly OwnedCosmetic[];
  /** Null while the balance loads; the buy button waits for it. */
  gemBalance: number | null;
  canBuy: boolean;
  onTopUp: (gemsNeeded: number) => void;
}

/**
 * Four tiers, each a card: the badge, the price for a month, what is in the
 * bundle. The one you hold says so and when it lapses; buying it again adds a
 * month. Zero points for anyone — this is cosmetics money, which the card says
 * in one line because people assume VIP pays hosts.
 */
export function VipShelf({ owned, gemBalance, canBuy, onTopUp }: Props) {
  const { t } = useTranslation();
  const tiers = useVipTiers();
  const sheet = useRef<SheetHandle>(null);
  const [chosen, setChosen] = useState<VipTier | null>(null);

  const current = owned.find(
    (item) =>
      item.kind === 'vip' &&
      item.equipped &&
      (item.expiresAt === null || daysLeft(item.expiresAt) > 0),
  );

  if (tiers.isError) {
    return <Banner message={errorMessage(tiers.error)} onRetry={() => void tiers.refetch()} />;
  }
  if (tiers.data === undefined) {
    return (
      <Column gap="md">
        <Skeleton height={140} rounding="lg" />
        <Skeleton height={140} rounding="lg" />
      </Column>
    );
  }

  return (
    <Column gap="md">
      <Text variant="caption" tone="secondary">
        {t('store.vipBody')}
      </Text>
      {tiers.data.map((tier, index) => {
        const mine = current?.cosmeticId === tier.id;
        const short = gemBalance !== null && gemBalance < tier.gemPrice;
        return (
          <Animated.View key={tier.id} entering={FadeInDown.duration(220).delay(index * 40)}>
            <View style={[styles.card, mine && styles.cardMine]} testID={`vip-tier-${tier.badge}`}>
              <Row justify="between" align="center">
                <Row gap="sm" align="center">
                  <VipBadge tier={tier.badge} />
                  <Text variant="heading">{tier.name}</Text>
                </Row>
                <Column align="end" gap="xs">
                  <Text variant="bodyStrong" style={styles.price}>
                    {formatGems(gems(tier.gemPrice))}
                  </Text>
                  <Text variant="micro" tone="faint">
                    {t('store.vipMonth', { days: tier.durationDays })}
                  </Text>
                </Column>
              </Row>

              <View style={styles.perks}>
                {tier.perks.map((perk) => (
                  <Row key={perk} gap="xs" align="center" style={styles.perk}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.vip[tier.badge]} />
                    <Text variant="caption" tone="secondary">
                      {t(PERK_LABEL[perk])}
                    </Text>
                  </Row>
                ))}
              </View>

              {mine && current?.expiresAt && (
                <Text variant="caption" tone="secondary" testID="vip-current">
                  {t('store.vipCurrent', { days: daysLeft(current.expiresAt) })}
                </Text>
              )}

              <Button
                label={
                  !canBuy
                    ? t('store.signUp')
                    : short
                      ? t('store.getGemsFor', { gems: formatGems(gems(tier.gemPrice)) })
                      : mine
                        ? t('store.vipExtend')
                        : t('store.vipBuy')
                }
                onPress={() => {
                  haptic.tap();
                  if (!canBuy) return;
                  if (short) {
                    onTopUp(tier.gemPrice - (gemBalance ?? 0));
                    return;
                  }
                  setChosen(tier);
                  sheet.current?.present();
                }}
                disabled={gemBalance === null && canBuy}
                variant={mine ? 'secondary' : 'primary'}
                fullWidth
                testID={`vip-buy-${tier.badge}`}
              />
            </View>
          </Animated.View>
        );
      })}
      <Text variant="micro" tone="faint" style={styles.note}>
        {t('store.vipNote')}
      </Text>

      <VipPurchaseSheet
        ref={sheet}
        tier={chosen}
        balance={gemBalance}
        extending={chosen?.id === current?.cosmeticId}
      />
    </Column>
  );
}

function VipPurchaseSheet({
  ref,
  tier,
  balance,
  extending,
}: {
  ref: React.Ref<SheetHandle>;
  tier: VipTier | null;
  balance: number | null;
  extending: boolean;
}) {
  const { t } = useTranslation();
  const purchase = usePurchaseVip();
  const [keys] = useState(() => new IntentKeys(randomUUID));
  const [failure, setFailure] = useState<unknown>(null);
  const inner = useRef<SheetHandle>(null);

  // The sheet clears its last failure on every present.
  useImperativeHandle(ref, () => ({
    present: () => {
      setFailure(null);
      inner.current?.present();
    },
    dismiss: () => inner.current?.dismiss(),
  }));

  if (!tier) return <Sheet ref={inner}>{null}</Sheet>;
  const after = balance === null ? null : balance - tier.gemPrice;

  async function confirm() {
    if (!tier) return;
    const signature = `vip:${tier.id}:${tier.gemPrice}`;
    const key = keys.begin(signature);
    haptic.tap();
    setFailure(null);
    try {
      await purchase.mutateAsync({
        tierId: tier.id,
        expectedGemPrice: tier.gemPrice,
        idempotencyKey: key,
      });
      keys.settle(signature, key, null);
      haptic.success();
      inner.current?.dismiss();
    } catch (error) {
      keys.settle(signature, key, error);
      haptic.error();
      setFailure(error);
    }
  }

  return (
    <Sheet ref={inner} title={tier.name}>
      <Row gap="md" align="center">
        <VipBadge tier={tier.badge} />
        <Column gap="xs" flex={1}>
          <Text variant="heading">
            {t('store.gemsAmount', { gems: formatGems(gems(tier.gemPrice)) })}
          </Text>
          <Text variant="caption" tone="secondary">
            {extending
              ? t('store.vipExtendNote', { days: tier.durationDays })
              : t('store.vipStartNote', { days: tier.durationDays })}
          </Text>
        </Column>
      </Row>
      {after !== null && after >= 0 && (
        <Text variant="caption" tone="secondary">
          {t('store.balanceAfter', { gems: formatGems(gems(after)) })}
        </Text>
      )}
      {failure !== null && (
        <Banner
          message={
            failure instanceof ApiError && failure.code === ApiErrorCode.INSUFFICIENT_BALANCE
              ? t('store.notEnoughGems')
              : errorMessage(failure)
          }
        />
      )}
      <Column gap="sm">
        <Button
          label={t('store.confirmBuy', { gems: formatGems(gems(tier.gemPrice)) })}
          onPress={() => void confirm()}
          loading={purchase.isPending}
          size="lg"
          fullWidth
          testID="confirm-vip-purchase"
        />
        <Button
          label={t('common.cancel')}
          onPress={() => inner.current?.dismiss()}
          variant="ghost"
          fullWidth
        />
      </Column>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  cardMine: { borderColor: colors.brand.solid, borderWidth: 1 },
  price: { color: colors.currency.gem },
  perks: { gap: spacing.xs },
  perk: { alignSelf: 'flex-start' },
  note: { textAlign: 'center' },
});
