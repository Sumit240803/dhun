import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { formatCompact } from '@/lib/money';
import { colors, duration, radius, typography } from '@/theme';
import { Text } from '@/ui';
import { assetUrl } from '@/visuals/assets';
import { LookAvatar } from '@/visuals/LookAvatar';

import { roomAssetPath } from '@/features/room/roomAssets';
import type { SeatGridLayout, StageSlot } from '@/features/room/model';

interface Props {
  slot: StageSlot;
  layout: SeatGridLayout;
  speaking: boolean;
  /** Coins this seat has received in the room so far. Hidden when zero. */
  coins: number | undefined;
  /** Tapping a taken seat opens a profile; tapping an empty one asks for it. */
  onPress: (slot: StageSlot) => void;
}

/**
 * One seat, in every state it can be in.
 *
 * ── Four states, and the references draw all of them differently ────────────
 *
 *   EMPTY     a numbered chair, inviting a tap
 *   TAKEN     avatar, frame, name, gift counter
 *   SPEAKING  a pulsing ring — audio levels flicker, so the ring breathes
 *             rather than blinking, which would strobe across twenty seats
 *   MUTED     a badge, because being silenced by the host is a state the whole
 *             room can see and the person needs to understand
 *
 * The seat NUMBER is drawn top-left and the gift COUNTER top-right, which is
 * the reference layout and is load-bearing: in a twenty-seat room the counter
 * is how a gifter finds who is being gifted, and the number is how somebody
 * asks for "seat 7" in chat.
 *
 * Memoised because a twenty-seat room re-renders this on every chat line
 * otherwise, and the pulse animation makes that visible.
 */
export const SeatTile = memo(function SeatTile({ slot, layout, speaking, coins, onPress }: Props) {
  const { t } = useTranslation();
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = speaking
      ? withRepeat(withTiming(1, { duration: 700 }), -1, true)
      : withTiming(0, { duration: duration.fast });
  }, [speaking, pulse]);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.3 + pulse.value * 0.7,
    transform: [{ scale: 1 + pulse.value * 0.07 }],
  }));

  const taken = slot.kind === 'taken';
  const name = taken ? (slot.displayName ?? '—') : null;

  return (
    <Animated.View
      entering={FadeInDown.duration(220).delay(Math.min(slot.seatIndex, 12) * 24)}
      style={{ width: layout.avatar + layout.gap }}
    >
      <Pressable
        onPress={() => onPress(slot)}
        accessibilityRole="button"
        accessibilityLabel={
          taken
            ? t('room.seatTakenLabel', { name: name ?? '', index: slot.seatIndex + 1 })
            : t('room.seatEmptyLabel', { index: slot.seatIndex + 1 })
        }
        style={styles.press}
        testID={`seat-${slot.seatIndex}`}
      >
        <View style={{ width: layout.avatar, height: layout.avatar }}>
          {speaking && <Animated.View style={[styles.ring, ring]} />}

          {taken ? (
            <LookAvatar
              name={name ?? '—'}
              size={layout.avatar}
              frame={slot.look?.frame}
              live={slot.isHost}
            />
          ) : (
            <EmptySeat diameter={layout.avatar} />
          )}

          {taken && slot.muted && (
            <View style={styles.mutedBadge}>
              <Ionicons
                name="mic-off"
                size={Math.max(8, layout.avatar * 0.2)}
                color={colors.text.onBrand}
              />
            </View>
          )}

          {/* Seat number, top-left. Shown on empty seats always — that is how
              somebody asks for one — and on taken seats only when there is
              room for it. */}
          {(layout.showMeta || !taken) && (
            <View style={styles.index}>
              <Text variant="micro" tone="onMedia" style={styles.indexText}>
                {slot.seatIndex + 1}
              </Text>
            </View>
          )}

          {/* What this seat has been gifted. Hidden at zero rather than shown
              as "0": an empty counter on every seat is noise, and a seat that
              has earned nothing does not need it announced. */}
          {taken && coins !== undefined && coins > 0 && (
            <View style={styles.coins}>
              <Ionicons name="gift" size={8} color={colors.text.onBrand} />
              <Text variant="micro" tone="onMedia" style={styles.coinsText}>
                {formatCompact(coins)}
              </Text>
            </View>
          )}
        </View>

        {layout.showMeta && (
          <Text
            variant="micro"
            tone="onMedia"
            numberOfLines={1}
            style={[styles.name, !taken && styles.nameEmpty, { width: layout.avatar + layout.gap }]}
          >
            {taken ? name : t('room.emptySeat')}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
});

/**
 * The chair nobody is sitting in.
 *
 * Art when `rooms/seats/placeholder` has been drawn, a dashed glass disc until
 * then. The fallback is deliberately not an icon of a person — an empty seat is
 * a place, and a grey human silhouette reads as a broken avatar.
 */
function EmptySeat({ diameter }: { diameter: number }) {
  const art = assetUrl(roomAssetPath('seatPlaceholder'));

  if (art !== null) {
    return (
      <Image
        source={{ uri: art }}
        style={{ width: diameter, height: diameter }}
        contentFit="contain"
        cachePolicy="memory-disk"
        accessible={false}
      />
    );
  }

  return (
    <View
      style={[
        styles.emptyFallback,
        { width: diameter, height: diameter, borderRadius: radius.pill },
      ]}
    >
      <Ionicons name="add" size={Math.max(12, diameter * 0.34)} color={colors.text.onMedia} />
    </View>
  );
}

const styles = StyleSheet.create({
  press: { alignItems: 'center', gap: 2 },
  ring: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.brand.accent,
  },
  mutedBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    padding: 2,
    borderRadius: 999,
    backgroundColor: colors.status.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.onMediaWell,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border.onMedia,
  },
  // Chips sit ON the avatar rather than beside it. At five columns there is no
  // beside — the whole seat is 38pt wide.
  index: {
    position: 'absolute',
    top: -2,
    left: -2,
    minWidth: 14,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
    alignItems: 'center',
  },
  indexText: { fontSize: 9, lineHeight: 13 },
  coins: {
    position: 'absolute',
    top: -2,
    right: -4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.solid,
  },
  coinsText: { fontSize: 9, lineHeight: 13 },
  name: { textAlign: 'center', fontSize: 10, lineHeight: 13 },
  nameEmpty: { opacity: 0.55, fontWeight: typography.body.fontWeight },
});
