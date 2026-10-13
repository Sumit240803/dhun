import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radius, spacing, zIndex } from '@/theme';
import { Text } from '@/ui';

import type { MarqueeQueue } from './marqueeQueue';

/** Scroll speed, points per second. Slow enough to read Hindi, which is wider. */
const SPEED = 60;

/**
 * The strip that never stops moving.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 *
 * In the references this carries "X sent Y to Z and won N coins" across every
 * room, and it is the social proof that makes a quiet room look busy. A room
 * where nothing has visibly happened in two minutes is a room people leave.
 *
 * Stateless: the queue lives in a `MarqueeQueue` the room screen owns, exactly
 * as the gift strips live in `GiftStripLanes`. Announcements arrive over the
 * socket, and a component that mirrored them into state would re-render the
 * room on every gift.
 */
export function RoomMarquee({ queue }: { queue: MarqueeQueue }) {
  const current = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);

  if (current === null) return null;

  return (
    <Animated.View
      entering={FadeInUp.duration(200)}
      style={[styles.root, current.kind === 'global' && styles.global]}
      pointerEvents="none"
      testID="room-marquee"
    >
      <Ionicons
        name={current.kind === 'global' ? 'megaphone' : 'gift'}
        size={11}
        color={colors.text.onMedia}
      />
      <ScrollingText text={current.text} />
    </Animated.View>
  );
}

/**
 * Text that scrolls only if it has to.
 *
 * Measured rather than assumed: most announcements fit, and scrolling one that
 * already fits is motion for its own sake — which the screen-craft rules call
 * decoration. Hindi is wider than English for the same sentence, so "does it
 * fit" cannot be answered by counting characters.
 */
function ScrollingText({ text }: { text: string }) {
  const [track, setTrack] = useState(0);
  const [content, setContent] = useState(0);
  const offset = useSharedValue(0);

  const overflow = content - track;

  useEffect(() => {
    cancelAnimation(offset);
    offset.value = 0;
    if (overflow <= 0 || track === 0) return;

    offset.value = withRepeat(
      withTiming(-overflow, {
        duration: (overflow / SPEED) * 1_000,
        easing: Easing.linear,
      }),
      -1,
      true,
    );
  }, [overflow, track, offset]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <View
      style={styles.track}
      onLayout={(event: LayoutChangeEvent) => setTrack(event.nativeEvent.layout.width)}
    >
      <Animated.View style={style}>
        <Text
          variant="micro"
          tone="onMedia"
          numberOfLines={1}
          onLayout={(event: LayoutChangeEvent) => setContent(event.nativeEvent.layout.width)}
          style={styles.text}
        >
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
    zIndex: zIndex.roomChrome,
  },
  // A Tier 5 crossing every room on the platform gets the brand fill, because
  // it is the one announcement that is not about this room at all.
  global: { backgroundColor: colors.brand.solid },
  track: { flex: 1, overflow: 'hidden' },
  text: { fontSize: 10, lineHeight: 14 },
});
