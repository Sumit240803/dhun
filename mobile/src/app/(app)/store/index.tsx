import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import {
  useCosmeticCatalog,
  useEquipCosmetic,
  useMyCosmetics,
  useUnequipCosmetic,
} from '@/api/queries/useCosmetics';
import { useProfileSummary } from '@/api/queries/useFeed';
import { useWallet } from '@/api/queries/useWallet';
import { EMPTY_LOOK, type Cosmetic, type CosmeticKind } from '@/api/types';
import { useFlag } from '@/config/flags';
import { ConvertSheet } from '@/features/cosmetics/ConvertSheet';
import { ItemSwatch } from '@/features/cosmetics/ItemSwatch';
import { itemStatus, previewLook, type ItemStatus } from '@/features/cosmetics/ownership';
import { PurchaseSheet } from '@/features/cosmetics/PurchaseSheet';
import { useTranslation, type MessageKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatGems } from '@/lib/money';
import { gems } from '@/lib/units';
import { useIsRegistered, useSession } from '@/store/session';
import { colors, radius, spacing } from '@/theme';
import {
  Banner,
  Button,
  EmptyState,
  Row,
  Screen,
  SegmentedTabs,
  Skeleton,
  Text,
  type SheetHandle,
} from '@/ui';
import { themed } from '@/visuals/look';
import { LookAvatar } from '@/visuals/LookAvatar';

const SHELVES: { kind: CosmeticKind; label: MessageKey }[] = [
  { kind: 'frame', label: 'store.frames' },
  { kind: 'chat_bubble', label: 'store.bubbles' },
  { kind: 'nickname_color', label: 'store.nameColours' },
  { kind: 'entry_effect', label: 'store.entries' },
];

/**
 * The cosmetics store — where gems are spent.
 *
 * Built around a live preview of the viewer THEMSELVES wearing the selected
 * item over what they already wear. That preview is the product: a frame sells
 * on seeing your own name inside it, not on a thumbnail.
 *
 * Gems are the only currency here, and the balance sits in the header beside
 * the way to get more. Coins never appear as a price — coins pay hosts, gems
 * do not, and mixing the two on one screen is how a user ends up confused about
 * what they spent.
 */
export default function StoreScreen() {
  const { t } = useTranslation();
  const isRegistered = useIsRegistered();
  const { user } = useSession();
  const conversionEnabled = useFlag('conversionEnabled');

  const catalog = useCosmeticCatalog();
  const mine = useMyCosmetics(isRegistered);
  const wallet = useWallet();
  const summary = useProfileSummary();
  const equip = useEquipCosmetic();
  const unequip = useUnequipCosmetic();

  const [shelf, setShelf] = useState<CosmeticKind>('frame');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const buySheet = useRef<SheetHandle>(null);
  const convertSheet = useRef<SheetHandle>(null);

  const name = user?.displayName ?? t('me.guest');
  const items = (catalog.data?.cosmetics ?? []).filter((item) => item.kind === shelf);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const status: ItemStatus = selected
    ? itemStatus(selected.id, mine.data ?? [])
    : { kind: 'available' };

  const wearing = summary.data?.look ?? EMPTY_LOOK;
  const preview = selected ? previewLook(wearing, selected) : wearing;
  const gemBalance = wallet.data?.gems ?? null;
  const short = selected !== null && gemBalance !== null && gemBalance < selected.gemPrice;

  function buyOrTopUp() {
    if (!selected) return;
    haptic.tap();
    if (short) {
      if (conversionEnabled) convertSheet.current?.present();
      else router.push('/(app)/wallet');
      return;
    }
    buySheet.current?.present();
  }

  const actionError = equip.error ?? unequip.error;

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
          {t('store.title')}
        </Text>

        <Pressable
          onPress={() => {
            haptic.tap();
            if (conversionEnabled) convertSheet.current?.present();
          }}
          disabled={!isRegistered || !conversionEnabled}
          accessibilityRole="button"
          accessibilityLabel={t('store.getGems')}
          style={styles.gemChip}
          testID="store-gems"
        >
          <Ionicons name="diamond" size={12} color={colors.currency.gem} />
          {gemBalance === null ? (
            <Skeleton width={40} height={14} />
          ) : (
            <Text variant="caption" style={styles.gemText}>
              {formatGems(gems(gemBalance))}
            </Text>
          )}
          {conversionEnabled && isRegistered && (
            <Ionicons name="add-circle" size={18} color={colors.currency.gem} />
          )}
        </Pressable>
      </Row>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* How you would look. Drawn from the same data a room uses. */}
        <Animated.View entering={FadeInDown.duration(260)} style={styles.preview}>
          <LookAvatar name={name} size="xl" frame={preview.frame} />
          <Text
            variant="title"
            numberOfLines={1}
            style={preview.nameColor ? { color: themed(preview.nameColor).color } : undefined}
          >
            {name}
          </Text>
          {preview.bubble && (
            <View
              style={[
                styles.previewBubble,
                {
                  backgroundColor: themed(preview.bubble).background,
                  borderColor: themed(preview.bubble).border,
                },
              ]}
            >
              <Text variant="body" style={{ color: themed(preview.bubble).text }}>
                {t('store.sampleMessage')}
              </Text>
            </View>
          )}
          {selected?.kind === 'entry_effect' && (
            <Text variant="caption" tone="secondary">
              {t('store.entryPreviewNote')}
            </Text>
          )}
        </Animated.View>

        <View style={styles.gutter}>
          <SegmentedTabs
            variant="pill"
            options={SHELVES.map((entry) => ({ value: entry.kind, label: t(entry.label) }))}
            value={shelf}
            onChange={(next) => {
              haptic.selection();
              setShelf(next);
              setSelectedId(null);
            }}
          />
        </View>

        {catalog.isError ? (
          <View style={styles.gutter}>
            <Banner message={errorMessage(catalog.error)} onRetry={() => void catalog.refetch()} />
          </View>
        ) : catalog.isLoading ? (
          <View style={styles.grid}>
            {Array.from({ length: 4 }, (_, index) => (
              <View key={index} style={styles.card}>
                <Skeleton width={56} height={56} rounding="pill" />
                <Skeleton width={80} height={12} />
              </View>
            ))}
          </View>
        ) : items.length === 0 ? (
          <EmptyState icon="sparkles-outline" title={t('store.shelfEmpty')} body="" />
        ) : (
          <View style={styles.grid}>
            {items.map((item, index) => (
              <ItemCard
                key={item.id}
                item={item}
                index={index}
                viewerName={name}
                selected={item.id === selected?.id}
                status={itemStatus(item.id, mine.data ?? [])}
                onPress={() => {
                  haptic.selection();
                  setSelectedId(item.id);
                }}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {selected && (
        <View style={styles.bar}>
          {actionError != null && (
            <Animated.View entering={FadeIn.duration(160)}>
              <Banner message={errorMessage(actionError)} />
            </Animated.View>
          )}

          {!isRegistered ? (
            <Button
              label={t('store.signUp')}
              onPress={() => {
                haptic.tap();
                router.push('/(auth)');
              }}
              size="lg"
              fullWidth
            />
          ) : status.kind === 'wearing' || status.kind === 'owned' ? (
            <Row gap="md">
              <View style={styles.barMain}>
                <Button
                  label={status.kind === 'wearing' ? t('store.takeOff') : t('store.wear')}
                  onPress={() => {
                    haptic.tap();
                    if (status.kind === 'wearing') unequip.mutate(selected.kind);
                    else equip.mutate(selected.id);
                  }}
                  loading={equip.isPending || unequip.isPending}
                  variant="secondary"
                  size="lg"
                  fullWidth
                  testID="store-wear"
                />
              </View>
              <Button
                label={t('store.extend')}
                onPress={buyOrTopUp}
                variant="ghost"
                size="lg"
                testID="store-extend"
              />
            </Row>
          ) : (
            <Button
              label={
                short
                  ? t('store.getGemsFor', { gems: formatGems(gems(selected.gemPrice)) })
                  : status.kind === 'expired'
                    ? t('store.renewFor', { gems: formatGems(gems(selected.gemPrice)) })
                    : t('store.buyFor', { gems: formatGems(gems(selected.gemPrice)) })
              }
              onPress={buyOrTopUp}
              size="lg"
              fullWidth
              testID="store-buy"
            />
          )}
        </View>
      )}

      <PurchaseSheet
        ref={buySheet}
        item={selected}
        status={status}
        balance={gemBalance}
        viewerName={name}
      />
      <ConvertSheet
        ref={convertSheet}
        coinBalance={wallet.data?.coins ?? 0}
        rateBp={catalog.data?.conversion.coinToGemRateBp ?? 10_000}
        minimumCoins={catalog.data?.conversion.minimumCoins ?? 1}
        gemsNeeded={
          selected && gemBalance !== null ? Math.max(0, selected.gemPrice - gemBalance) : undefined
        }
      />
    </Screen>
  );
}

function ItemCard({
  item,
  index,
  viewerName,
  selected,
  status,
  onPress,
}: {
  item: Cosmetic;
  index: number;
  viewerName: string;
  selected: boolean;
  status: ItemStatus;
  onPress: () => void;
}) {
  const { t, tPlural } = useTranslation();

  const caption =
    status.kind === 'wearing'
      ? tPlural('store.wearingDay', 'store.wearingDays', status.daysLeft)
      : status.kind === 'owned'
        ? tPlural('store.ownedDay', 'store.ownedDays', status.daysLeft)
        : status.kind === 'expired'
          ? t('store.expired')
          : tPlural('store.forDay', 'store.forDays', item.durationDays ?? 0);

  return (
    <Animated.View
      entering={FadeInDown.duration(220).delay(index * 40)}
      style={[styles.card, selected && styles.cardSelected]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${item.name}, ${formatGems(gems(item.gemPrice))}, ${caption}`}
        style={styles.cardPress}
        testID={`store-item-${item.id}`}
      >
        <ItemSwatch item={item} name={viewerName} />
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.name}
        </Text>
        <Row gap="xs">
          <Ionicons name="diamond" size={10} color={colors.currency.gem} />
          <Text variant="caption" style={styles.price}>
            {formatGems(gems(item.gemPrice))}
          </Text>
        </Row>
        <Text
          variant="micro"
          tone={
            status.kind === 'wearing' ? 'brand' : status.kind === 'expired' ? 'danger' : 'faint'
          }
        >
          {caption}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { height: 52, paddingHorizontal: spacing.lg },
  title: { flex: 1 },
  gemChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.currency.gemSoft,
  },
  gemText: { color: colors.currency.gem, fontWeight: '700' },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.lg },
  preview: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    marginHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.raised,
  },
  previewBubble: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.sm,
    borderWidth: 1.5,
  },
  gutter: { paddingHorizontal: spacing.lg },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  card: {
    // Two across, and a lone last card keeps its width rather than stretching.
    width: '47%',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  cardSelected: { borderColor: colors.brand.accent },
  cardPress: { alignItems: 'center', gap: spacing.xs, padding: spacing.md },
  price: { color: colors.currency.gem, fontWeight: '700' },
  bar: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  barMain: { flex: 1 },
});
