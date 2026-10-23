// The new-user exclusive rewards sheet.
//
// Laid out from app-reference-images/5ca7a773-…jpg: a gradient header with the
// title and a live countdown, the chest breaking out of the top edge, one card
// of tasks with a pill button each, and a "more rewards" card underneath. Same
// type sizes and structure as the reference; Dhun's violet instead of its pink.
//
// ── What the window is ──────────────────────────────────────────────────────
//
// Seven days from ACCOUNT CREATION, fixed on the server. Closing the app,
// reinstalling, or coming back after a month never restarts it — the server
// returns `null` once it has passed and the sheet simply stops existing.
//
// ── What each row pays ──────────────────────────────────────────────────────
//
// "Check in today" is the ordinary daily check-in and pays its ladder — it is
// on this sheet so a new user meets it, not a second daily reward. The other
// three pay once each, after the action has really happened: the server
// derives "done" from follows, gift_sends and room_messages, so a claim for
// something not done is refused there, not merely hidden here.

import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { discoverApi } from '@/api/endpoints/growth';
import { queryKeys } from '@/api/queries/keys';
import {
  useCheckin,
  useClaimNewUserTask,
  useNewUserRewards,
  useRewards,
} from '@/api/queries/useGrowth';
import type { NewUserTaskId } from '@/api/types';
import { roomAssetPath } from '@/features/room/roomAssets';
import { useTranslation, type MessageKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins } from '@/lib/money';
import { istDate, preferences } from '@/lib/preferences';
import { coins } from '@/lib/units';
import { useIsRegistered } from '@/store/session';
import { colors, radius, spacing } from '@/theme';
import { Banner, Text } from '@/ui';
import { assetUrl } from '@/visuals/assets';
import { useCountdown } from './countdown';
import { newUserSheet, useNewUserSheetOpen } from './sheetStore';

const SHOWN_ON = 'rewards.newUserShownOn';

const TASK_TITLES: Record<NewUserTaskId, MessageKey> = {
  follow: 'newUser.taskFollow',
  gift: 'newUser.taskGift',
  chat: 'newUser.taskChat',
};

/** One row of the card, whichever endpoint it came from. */
interface Row {
  key: 'checkin' | NewUserTaskId;
  title: string;
  coins: number;
  done: boolean;
  claimed: boolean;
}

/**
 * Mounted once, in the tab layout. Opens itself on the first app open of each
 * IST day while the window is open and something is still unclaimed — once,
 * like the daily prompt it stands in for during the first week.
 */
export function NewUserSheet() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const isRegistered = useIsRegistered();
  const open = useNewUserSheetOpen();

  const newUser = useNewUserRewards(isRegistered);
  const rewards = useRewards(isRegistered);
  const claimTask = useClaimNewUserTask();
  const checkin = useCheckin();
  const [earned, setEarned] = useState<number | null>(null);

  const data = newUser.data ?? null;
  const remaining = useCountdown(data?.endsAt ?? null, data?.clockOffsetMs ?? 0);
  const expired = data !== null && remaining.ms === 0;

  const rows: Row[] = [];
  if (data && rewards.data) {
    const { checkin: today } = rewards.data;
    rows.push({
      key: 'checkin',
      title: t('newUser.taskCheckin'),
      coins: today.ladder[today.streakDay - 1] ?? 0,
      // Opening the app IS the action; what is left is claiming it.
      done: true,
      claimed: today.claimedToday,
    });
  }
  for (const task of data?.tasks ?? []) {
    rows.push({ key: task.id, title: t(TASK_TITLES[task.id]), ...task });
  }
  const anythingLeft = rows.some((row) => !row.claimed);

  // ── Once a day, on its own ────────────────────────────────────────────────
  const decided = useRef(false);
  useEffect(() => {
    if (!anythingLeft || expired || decided.current) return;
    decided.current = true;

    void (async () => {
      const today = istDate();
      if ((await preferences.get(SHOWN_ON)) === today) return;
      await preferences.set(SHOWN_ON, today);
      newUserSheet.open();
    })();
  }, [anythingLeft, expired]);

  // The window closed while the app was open: drop the sheet and let the
  // server say so, which removes the floating entry too.
  useEffect(() => {
    if (!expired) return;
    newUserSheet.close();
    void queryClient.invalidateQueries({ queryKey: queryKeys.rewards.newUser() });
  }, [expired, queryClient]);

  if (!data || expired) return null;

  const close = () => {
    haptic.selection();
    newUserSheet.close();
  };

  const claim = (row: Row) => {
    const onSuccess = (result: { coins: number; alreadyClaimed: boolean }) => {
      haptic.success();
      if (!result.alreadyClaimed) setEarned(result.coins);
    };
    const onError = () => haptic.error();

    if (row.key === 'checkin') checkin.mutate(undefined, { onSuccess, onError });
    else claimTask.mutate(row.key, { onSuccess, onError });
  };

  // Every task happens in a live room — following its host, gifting, saying
  // something — so GO takes the user to the fullest one. With nothing live it
  // leaves them on the feed, which is where the rooms will appear.
  const go = async (row: Row) => {
    haptic.selection();
    newUserSheet.close();
    const fullest = await discoverApi.fullestRoom().catch(() => null);
    if (fullest?.room) {
      router.push({ pathname: '/(app)/room/[id]', params: { id: fullest.room.id } });
    }
  };

  const more = () => {
    haptic.selection();
    newUserSheet.close();
    router.push('/(app)/rewards');
  };

  const claimError = claimTask.error ?? checkin.error;
  const pending = claimTask.isPending || checkin.isPending;
  const chest = assetUrl(roomAssetPath('freeCoinChest'));
  const giftBox = assetUrl(roomAssetPath('rewardGiftBox'));

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={close}
    >
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={t('newUser.close')} />

      <View style={styles.sheet} testID="new-user-sheet">
        <Pressable
          onPress={close}
          hitSlop={12}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel={t('newUser.close')}
        >
          <Ionicons name="close" size={18} color={colors.text.onMedia} />
        </Pressable>

        <LinearGradient
          colors={[colors.promo.headerStart, colors.promo.headerEnd, colors.promo.body]}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.3, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerText}>
            <Text variant="heading" tone="onMedia" numberOfLines={2}>
              {t('newUser.title')}
            </Text>
            <View style={styles.timeRow}>
              <Text variant="caption" tone="onMedia">
                {t('newUser.timeLeft')}{' '}
              </Text>
              <Text
                variant="caption"
                tone="onMedia"
                style={styles.timeValue}
                testID="new-user-countdown"
              >
                {t('newUser.countdown', remaining)}
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* Breaks out of the header's top edge, as the reference's chest does. */}
        <View style={styles.chest} pointerEvents="none">
          {chest ? (
            <Image source={{ uri: chest }} style={styles.chestImage} contentFit="contain" />
          ) : (
            <View style={styles.chestFallback}>
              <Ionicons name="gift" size={52} color={colors.currency.coin} />
            </View>
          )}
        </View>

        <View style={[styles.body, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.card}>
            {rows.map((row, index) => (
              <Animated.View
                key={row.key}
                entering={FadeInDown.duration(200).delay(index * 40)}
                style={styles.row}
                testID={`new-user-task-${row.key}`}
              >
                <View style={styles.rowText}>
                  <View style={styles.titleLine}>
                    <Text variant="bodyStrong" numberOfLines={1} style={styles.rowTitle}>
                      {row.title}
                    </Text>
                    <Text variant="body" tone="faint">
                      {t('newUser.progress', { done: row.done ? 1 : 0 })}
                    </Text>
                  </View>
                  <View style={styles.chip}>
                    <Ionicons name="ellipse" size={10} color={colors.currency.coin} />
                    <Text variant="caption" style={styles.chipText}>
                      {t('newUser.reward', { coins: formatCoins(coins(row.coins)) })}
                    </Text>
                  </View>
                </View>

                <RowButton
                  row={row}
                  disabled={pending}
                  onClaim={() => claim(row)}
                  onGo={() => void go(row)}
                />
              </Animated.View>
            ))}
          </View>

          {claimError != null && <Banner message={errorMessage(claimError)} />}
          {earned !== null && (
            <Animated.View entering={FadeIn.duration(200)}>
              <Text variant="bodyStrong" style={styles.earned}>
                {t('newUser.claimed', { coins: formatCoins(coins(earned)) })}
              </Text>
            </Animated.View>
          )}

          <Pressable
            onPress={more}
            style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            {giftBox ? (
              <Image source={{ uri: giftBox }} style={styles.giftBox} contentFit="contain" />
            ) : (
              <View style={styles.giftBoxFallback}>
                <Ionicons name="gift-outline" size={26} color={colors.promo.link} />
              </View>
            )}
            <Text variant="bodyStrong" style={styles.moreText}>
              {t('newUser.more')}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.promo.link} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function RowButton({
  row,
  disabled,
  onClaim,
  onGo,
}: {
  row: Row;
  disabled: boolean;
  onClaim: () => void;
  onGo: () => void;
}) {
  const { t } = useTranslation();

  if (row.claimed) {
    return (
      <View style={[styles.button, styles.buttonDone]}>
        <Text variant="bodyStrong" tone="faint">
          {t('newUser.done')}
        </Text>
      </View>
    );
  }

  const ready = row.done;
  return (
    <Pressable
      onPress={ready ? onClaim : onGo}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        pressed && { backgroundColor: colors.promo.ctaPressed },
        disabled && styles.pressed,
      ]}
      accessibilityRole="button"
      testID={`new-user-${ready ? 'claim' : 'go'}-${row.key}`}
    >
      <Text variant="bodyStrong" tone="onBrand">
        {ready ? t('newUser.claim') : t('newUser.go')}
      </Text>
    </Pressable>
  );
}

const CHEST = 128;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.glass.scrim },
  sheet: {
    backgroundColor: colors.promo.body,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  close: {
    position: 'absolute',
    top: -(CHEST / 2) - spacing.md,
    right: spacing.lg,
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.glass.scrim,
    borderWidth: 1,
    borderColor: colors.border.onMedia,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  header: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  // Leaves room on the right for the chest.
  headerText: { paddingRight: CHEST - spacing.lg, gap: spacing.xs },
  timeRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  timeValue: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  chest: {
    position: 'absolute',
    top: -(CHEST / 2) + spacing.sm,
    right: spacing.md,
    width: CHEST,
    height: CHEST,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  chestImage: { width: CHEST, height: CHEST },
  chestFallback: {
    width: CHEST - spacing.xxl,
    height: CHEST - spacing.xxl,
    borderRadius: radius.xl,
    backgroundColor: colors.promo.headerStart,
    borderWidth: 3,
    borderColor: colors.currency.coin,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-6deg' }],
  },
  body: {
    marginTop: -spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.promo.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowText: { flex: 1, gap: spacing.sm },
  titleLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  rowTitle: { flexShrink: 1 },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.promo.chip,
  },
  chipText: { color: colors.text.primary, fontVariant: ['tabular-nums'] },
  button: {
    minWidth: 104,
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.promo.cta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDone: { backgroundColor: colors.promo.chip },
  pressed: { opacity: 0.7 },
  earned: { color: colors.promo.link, textAlign: 'center' },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.promo.card,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  giftBox: { width: 44, height: 44 },
  giftBoxFallback: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.promo.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: { flex: 1, color: colors.promo.link },
});
