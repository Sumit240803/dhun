// One gift strip: who sent what, and how many.
//
// Slides in from the right edge, settles on the left, holds, and leaves off
// the left edge — right to left across the room. It rests rather than drifting
// continuously because a strip that never stops moving cannot be READ, and the
// gift name and the count are the whole point of it.

import { memo, useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useTranslation } from '@/i18n';
import { colors, duration, radius, spacing, type TierKey } from '@/theme';
import { Avatar, Text } from '@/ui';
import { assetUrl } from './assets';
import { GiftIcon } from './GiftIcon';
import type { GiftStrip as GiftStripModel } from './giftStrips';

/** Fixed, so the layer can place lanes without measuring each strip. */
export const STRIP_HEIGHT = 52;
export const STRIP_GAP = spacing.xs;

interface Props {
  strip: GiftStripModel;
  /** The room's host. Their name is omitted as the recipient — it is implied. */
  hostId: string | undefined;
  onExited: (key: string) => void;
}

function GiftStripView({ strip, hostId, onExited }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const x = useSharedValue(reduceMotion ? 0 : width);
  const opacity = useSharedValue(0);
  const pulse = useSharedValue(1);

  // Entrance, once per strip. Keyed on `strip.key` rather than on every prop,
  // so a merged combo pulses the count instead of replaying the whole slide.
  useEffect(() => {
    x.set(
      withTiming(0, {
        duration: reduceMotion ? 0 : duration.giftStripEnter,
        easing: Easing.out(Easing.cubic),
      }),
    );
    opacity.set(withTiming(1, { duration: duration.giftStripEnter }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strip.key]);

  // A combo landed. The count bumps — motion that explains a change, which is
  // the only kind the room uses. Skipped on the first render, where `combo` is
  // 0 and there is nothing to explain yet.
  useEffect(() => {
    if (strip.combo === 0 || reduceMotion) return;
    pulse.set(
      withSequence(
        withTiming(1.28, { duration: 90, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 160, easing: Easing.in(Easing.quad) }),
      ),
    );
  }, [strip.combo, pulse, reduceMotion]);

  // Leaving: off the LEFT edge, continuing the right-to-left direction, then
  // tell the lanes it is gone so the next strip can take the space.
  useEffect(() => {
    if (!strip.leaving) return;

    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(onExited, strip.key);
    };

    opacity.set(withTiming(0, { duration: duration.giftStripExit }));
    x.set(
      withTiming(
        reduceMotion ? 0 : -width,
        { duration: duration.giftStripExit, easing: Easing.in(Easing.cubic) },
        done,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strip.leaving]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateX: x.get() }],
  }));

  const countStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.get() }],
  }));

  const { event } = strip;
  const tierColor = colors.tier[Math.min(Math.max(event.tier, 1), 5) as TierKey];

  // Written as whole sentences with slots, never assembled from fragments —
  // Hindi puts the verb last, so "sent" + gift + "to" + name reads wrong.
  const action =
    event.recipientId !== hostId && event.recipientName
      ? t('room.stripSentTo', { gift: event.giftName, name: event.recipientName })
      : t('room.stripSent', { gift: event.giftName });

  return (
    <Animated.View
      style={[styles.strip, { borderLeftColor: tierColor }, containerStyle]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${event.senderName} ${action} x${strip.count}`}
      // Announced to a screen reader like a toast, not focused: a gift in a
      // busy room is news, not something to navigate to.
      accessibilityLiveRegion="polite"
    >
      <View style={styles.avatar}>
        <Avatar
          uri={event.senderAvatar}
          name={event.senderName}
          size="sm"
          frameUri={assetUrl(event.senderFrame)}
        />
      </View>

      <View style={styles.text}>
        <Text variant="caption" numberOfLines={1} style={styles.name}>
          {event.senderName}
        </Text>
        <Text variant="micro" numberOfLines={1} style={styles.action}>
          {action}
        </Text>
      </View>

      {/* onMedia fallback, not the tier colour — the same contrast problem as
          the count. */}
      <GiftIcon path={event.giftIcon} tier={event.tier} size={30} onMedia />

      <Animated.View style={countStyle}>
        <Text variant="heading" style={styles.count}>
          x{strip.count}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Memoised on the fields that change what it draws.
 *
 * A busy room re-renders the layer on every strip change, and without this all
 * three lanes re-render whenever one of them merges a combo.
 */
export const GiftStrip = memo(
  GiftStripView,
  (a, b) =>
    a.strip.key === b.strip.key &&
    a.strip.count === b.strip.count &&
    a.strip.combo === b.strip.combo &&
    a.strip.leaving === b.strip.leaving &&
    a.strip.event.senderFrame === b.strip.event.senderFrame &&
    a.hostId === b.hostId,
);

const styles = StyleSheet.create({
  strip: {
    height: STRIP_HEIGHT,
    alignSelf: 'flex-start',
    maxWidth: '82%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.xs,
    paddingRight: spacing.md,
    borderRadius: radius.pill,
    borderLeftWidth: 3,
    // Dark in both themes. A strip has to read over a light room, a dark room
    // and a host's video alike, and only a scrim does all three.
    backgroundColor: colors.bg.videoScrim,
  },
  // Room for the frame's ornament, which extends past the avatar by design.
  avatar: { padding: 4 },
  text: { flexShrink: 1, minWidth: 0 },
  name: { color: colors.text.onMedia, fontWeight: '700' },
  action: { color: colors.text.onMedia, opacity: 0.85 },
  // White rather than the tier colour: several tier colours are too dark to
  // read on the scrim, and the count is the one thing everyone looks at. The
  // tier shows in the strip's edge instead.
  count: { color: colors.text.onMedia, fontWeight: '800' },
});
