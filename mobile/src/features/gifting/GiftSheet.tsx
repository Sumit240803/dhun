// The gift sheet — where money is spent.
//
// Everything about this screen is shaped by one fact: it is the moment of
// purchase, and friction here is revenue lost. So:
//
//   · ONE TAP SENDS. No confirmation dialog — the build plan and the economy
//     doc both say so, and a combo is the thumb tapping as fast as it can.
//   · A COMBO KEEPS GOING. After a send, the button offers the same gift again
//     for a few seconds, counting up.
//   · THE PRICE IS ALWAYS VISIBLE, as a total, next to the balance it comes out
//     of. A one-tap spend is only fair when the spend is never a surprise.
//   · NOTHING DEAD-ENDS. Not enough coins offers the top-up; a repriced gift
//     refreshes the catalog and says so; a recipient who stepped off stage is
//     named as the reason.

import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ApiError } from '@/api/client';
import { useSendGift } from '@/api/queries/useGifts';
import { queryKeys } from '@/api/queries/keys';
import { useGiftCatalog, useWallet } from '@/api/queries/useWallet';
import {
  ApiErrorCode,
  GIFT_QUANTITIES,
  type Gift,
  type GiftQuantity,
  type GiftView,
} from '@/api/types';
import { useTranslation, type MessageKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins, formatCompact } from '@/lib/money';
import { coins } from '@/lib/units';
import { useIsRegistered } from '@/store/session';
import { colors, radius, spacing, type TierKey } from '@/theme';
import {
  Avatar,
  Banner,
  Button,
  Chip,
  Column,
  EmptyState,
  Row,
  SegmentedTabs,
  Sheet,
  Skeleton,
  Text,
  type SheetHandle,
} from '@/ui';
import { GiftIcon } from '@/visuals/GiftIcon';
import type { GiftRecipient } from './recipients';
import { SendIntents } from './sendIntent';

/** How long the button keeps offering "again" after a send. */
const COMBO_WINDOW_MS = 3_000;

const TIER_LABELS: Record<TierKey, MessageKey> = {
  1: 'gifting.tier1',
  2: 'gifting.tier2',
  3: 'gifting.tier3',
  4: 'gifting.tier4',
  5: 'gifting.tier5',
};

export interface GiftSheetProps {
  ref?: Ref<SheetHandle>;
  roomId: string;
  /** Host first, then seats, never the viewer — see recipients.ts. */
  recipients: GiftRecipient[];
  /** A send committed. The room shows it at once, before the socket echoes it. */
  onSent: (gift: GiftView) => void;
}

export function GiftSheet({ ref, roomId, recipients, onSent }: GiftSheetProps) {
  const { t } = useTranslation();
  const isRegistered = useIsRegistered();
  const sheet = useRef<SheetHandle>(null);

  // The room screen presents it; this component also dismisses it on the way
  // to the top-up screen, so it holds the sheet and exposes the same handle.
  useImperativeHandle(ref, () => ({
    present: () => sheet.current?.present(),
    dismiss: () => sheet.current?.dismiss(),
  }));

  return (
    <Sheet ref={sheet}>
      {isRegistered ? (
        <GiftPicker
          roomId={roomId}
          recipients={recipients}
          onSent={onSent}
          onTopUp={() => {
            sheet.current?.dismiss();
            router.push('/(app)/wallet');
          }}
        />
      ) : (
        // A guest can watch and never spend — the server refuses them. Saying
        // why, with the way forward, beats a send button that errors.
        <EmptyState
          icon="gift-outline"
          title={t('gifting.guestTitle')}
          body={t('gifting.guestBody')}
          actionLabel={t('room.guestAction')}
          onAction={() => {
            haptic.tap();
            sheet.current?.dismiss();
            router.push('/(auth)');
          }}
          testID="gift-signup"
        />
      )}
    </Sheet>
  );
}

function GiftPicker({
  roomId,
  recipients,
  onSent,
  onTopUp,
}: {
  roomId: string;
  recipients: GiftRecipient[];
  onSent: (gift: GiftView) => void;
  onTopUp: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const catalog = useGiftCatalog();
  const wallet = useWallet();
  const send = useSendGift(roomId);

  const [intents] = useState(() => new SendIntents(randomUUID));
  const [tier, setTier] = useState<number | null>(null);
  const [giftId, setGiftId] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<GiftQuantity>(1);
  const [combo, setCombo] = useState(0);
  const [failure, setFailure] = useState<unknown>(null);

  const comboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (comboTimer.current) clearTimeout(comboTimer.current);
    },
    [],
  );

  const gifts = catalog.data ?? [];
  const tiers = [...new Set(gifts.map((gift) => gift.tier))].sort((a, b) => a - b);
  const activeTier = tier ?? tiers[0];
  const shown = gifts.filter((gift) => gift.tier === activeTier);

  // Derived rather than synced in an effect: a gift withdrawn from the catalog,
  // or a recipient who left the stage, simply falls back to the first choice.
  const gift = gifts.find((candidate) => candidate.id === giftId) ?? shown[0] ?? null;
  const recipient =
    recipients.find((candidate) => candidate.userId === recipientId) ?? recipients[0] ?? null;

  const total = gift ? gift.coinPrice * quantity : 0;
  const balance = wallet.data?.coins;
  const shortOfCoins = balance !== undefined && total > balance;

  /** Any change of choice ends the combo — "again" means the same gift again. */
  function choose(update: () => void) {
    haptic.selection();
    update();
    setCombo(0);
    setFailure(null);
  }

  async function fire() {
    if (!gift || !recipient) return;

    const intent = { roomId, recipientId: recipient.userId, giftId: gift.id, quantity };
    const key = intents.begin(intent);
    haptic.tap();
    setFailure(null);

    // mutateAsync, not mutate with callbacks: overlapping combo taps each need
    // their own outcome, and per-call callbacks fire only for the LAST call.
    try {
      const result = await send.mutateAsync({
        ...intent,
        expectedCoinPrice: gift.coinPrice,
        idempotencyKey: key,
      });
      intents.settle(intent, key, null);
      haptic.success();
      onSent(result.gift);

      setCombo((count) => count + 1);
      if (comboTimer.current) clearTimeout(comboTimer.current);
      comboTimer.current = setTimeout(() => setCombo(0), COMBO_WINDOW_MS);
    } catch (error) {
      intents.settle(intent, key, error);
      haptic.error();
      setCombo(0);
      setFailure(error);

      // The catalog the sheet is showing is out of date. Nothing was charged;
      // refreshing puts the real price in front of the user before they retry.
      if (
        error instanceof ApiError &&
        (error.code === ApiErrorCode.GIFT_PRICE_CHANGED ||
          error.code === ApiErrorCode.GIFT_NOT_FOUND)
      ) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.gifts() });
      }
      if (error instanceof ApiError && error.code === ApiErrorCode.INSUFFICIENT_BALANCE) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.wallet.balance() });
      }
    }
  }

  const insufficient =
    failure instanceof ApiError && failure.code === ApiErrorCode.INSUFFICIENT_BALANCE;

  return (
    <Column gap="md">
      <Row justify="between">
        <Text variant="heading">{t('gifting.title')}</Text>
        <Pressable
          onPress={() => {
            haptic.tap();
            onTopUp();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('gifting.topUp')}
          hitSlop={spacing.sm}
          style={styles.balance}
          testID="gift-top-up"
        >
          <Ionicons name="ellipse" size={12} color={colors.currency.coin} />
          {balance === undefined ? (
            <Skeleton width={48} height={14} />
          ) : (
            <Text variant="caption" style={styles.balanceText}>
              {formatCoins(coins(balance))}
            </Text>
          )}
          <Ionicons name="add-circle" size={18} color={colors.currency.coin} />
        </Pressable>
      </Row>

      {recipients.length === 0 ? (
        <Text variant="body" tone="secondary">
          {t('gifting.noRecipients')}
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recipients}
        >
          {recipients.map((candidate) => {
            const selected = candidate.userId === recipient?.userId;
            return (
              <Pressable
                key={candidate.userId}
                onPress={() => choose(() => setRecipientId(candidate.userId))}
                accessibilityRole="button"
                accessibilityLabel={t('gifting.sendTo', { name: candidate.name })}
                accessibilityState={{ selected }}
                style={[styles.recipient, selected && styles.recipientSelected]}
              >
                <Avatar name={candidate.name} size="xs" />
                <Text variant="caption" tone={selected ? 'brand' : 'secondary'} numberOfLines={1}>
                  {candidate.isHost ? t('room.hostLabel') : candidate.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {catalog.isError ? (
        <Banner message={errorMessage(catalog.error)} onRetry={() => void catalog.refetch()} />
      ) : catalog.isLoading ? (
        <View style={styles.grid}>
          {Array.from({ length: 8 }, (_, index) => (
            <View key={index} style={styles.tile}>
              <Skeleton width={48} height={48} rounding="pill" />
              <Skeleton width={40} height={10} />
            </View>
          ))}
        </View>
      ) : (
        <>
          {tiers.length > 1 && (
            <SegmentedTabs
              variant="pill"
              options={tiers.map((value) => ({
                value: String(value),
                label: t(TIER_LABELS[Math.min(Math.max(value, 1), 5) as TierKey]),
              }))}
              value={String(activeTier)}
              onChange={(next) =>
                choose(() => {
                  setTier(Number(next));
                  setGiftId(null);
                })
              }
            />
          )}

          <View style={styles.grid}>
            {shown.map((candidate) => (
              <GiftTile
                key={candidate.id}
                gift={candidate}
                selected={candidate.id === gift?.id}
                onPress={() => choose(() => setGiftId(candidate.id))}
              />
            ))}
          </View>
        </>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quantities}
      >
        {GIFT_QUANTITIES.map((value) => (
          <Chip
            key={value}
            label={t('gifting.combo', { count: value })}
            selected={value === quantity}
            onPress={() => choose(() => setQuantity(value))}
            testID={`gift-quantity-${value}`}
          />
        ))}
      </ScrollView>

      {failure !== null && (
        <Animated.View entering={FadeIn.duration(160)}>
          <Banner
            message={giftFailureMessage(failure, t)}
            tone={insufficient ? 'warning' : 'danger'}
          />
        </Animated.View>
      )}

      {insufficient || shortOfCoins ? (
        // Short of coins is known BEFORE tapping, from the balance beside the
        // price. Offering a send that is certain to fail would be a trick.
        <Button
          label={t('gifting.topUpFor', { coins: formatCoins(coins(total)) })}
          onPress={() => {
            haptic.tap();
            onTopUp();
          }}
          size="lg"
          fullWidth
          testID="gift-top-up-cta"
        />
      ) : (
        <Button
          label={
            combo > 0
              ? t('gifting.sendAgain', { count: combo + 1 })
              : t('gifting.sendFor', { coins: formatCoins(coins(total)) })
          }
          onPress={() => void fire()}
          disabled={gift === null || recipient === null}
          size="lg"
          fullWidth
          testID="gift-send"
        />
      )}
    </Column>
  );
}

function GiftTile({
  gift,
  selected,
  onPress,
}: {
  gift: Gift;
  selected: boolean;
  onPress: () => void;
}) {
  const tint = colors.tier[Math.min(Math.max(gift.tier, 1), 5) as TierKey];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${gift.name}, ${formatCoins(coins(gift.coinPrice))}`}
      accessibilityState={{ selected }}
      style={[styles.tile, selected && { borderColor: tint, backgroundColor: colors.bg.raised }]}
      testID={`gift-${gift.id}`}
    >
      <GiftIcon path={gift.iconAsset} tier={gift.tier} size={48} />
      <Text variant="micro" numberOfLines={1}>
        {gift.name}
      </Text>
      <Row gap="xs">
        <Ionicons name="ellipse" size={8} color={colors.currency.coin} />
        <Text variant="micro" tone="secondary">
          {formatCompact(gift.coinPrice)}
        </Text>
      </Row>
    </Pressable>
  );
}

/**
 * The sentence for a failed send.
 *
 * The shared mapper, except for two codes that mean something more specific
 * here: a balance that is short of THIS gift, and the kill switch — a 503 the
 * mapper would call an unexpected failure, when it is a deliberate pause and
 * nothing was charged.
 */
function giftFailureMessage(error: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (error instanceof ApiError) {
    if (error.code === ApiErrorCode.INSUFFICIENT_BALANCE) return t('gifting.notEnoughCoins');
    if (error.code === ApiErrorCode.TXN_TYPE_INACTIVE) return t('gifting.unavailable');
  }
  return errorMessage(error);
}

const styles = StyleSheet.create({
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.currency.coinSoft,
  },
  balanceText: { color: colors.currency.coin, fontWeight: '700' },
  recipients: { gap: spacing.sm },
  recipient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 160,
    paddingLeft: spacing.xs,
    paddingRight: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  recipientSelected: { borderColor: colors.brand.accent, backgroundColor: colors.bg.raised },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    // Four across on a phone, with the gaps accounted for.
    width: '23%',
    flexGrow: 1,
    maxWidth: '25%',
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  quantities: { gap: spacing.sm },
});
