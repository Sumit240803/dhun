// Floating emoji over the stage's lower right — what a tap on the heart does.
//
// One rise per reaction: up and out over a second and a half, drifting a
// little sideways so a burst reads as a burst and not a column. Motion that
// explains an event (somebody reacted), then gone. Nothing loops.

import { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { Reaction } from '@/api/types';
import type { FloatingReaction, ReactionQueue } from './reactionQueue';

export const REACTION_GLYPHS: Record<Reaction, string> = {
  heart: '❤️',
  clap: '👏',
  fire: '🔥',
  laugh: '😂',
  wow: '😮',
  party: '🎉',
};

/** The lane is 72 wide; a reaction starts somewhere across it. */
const LANE_WIDTH = 72;
const RISE = 220;

export function ReactionLayer({ queue }: { queue: ReactionQueue }) {
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);

  return (
    <View style={styles.lane} pointerEvents="none" testID="reaction-layer">
      {items.map((item) => (
        <Floating key={item.id} item={item} />
      ))}
    </View>
  );
}

function Floating({ item }: { item: FloatingReaction }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: 1_500, easing: Easing.out(Easing.quad) });
  }, [progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value < 0.7 ? 1 : 1 - (progress.value - 0.7) / 0.3,
    transform: [
      { translateY: -RISE * progress.value },
      { translateX: item.drift * progress.value },
      { scale: 0.8 + 0.4 * Math.min(progress.value * 4, 1) },
    ],
  }));

  return (
    <Animated.Text
      style={[styles.glyph, { left: item.lane * (LANE_WIDTH - 28) }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {REACTION_GLYPHS[item.emoji]}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  lane: {
    position: 'absolute',
    right: 8,
    bottom: 0,
    width: LANE_WIDTH,
    height: RISE + 40,
  },
  glyph: { position: 'absolute', bottom: 0, fontSize: 26, lineHeight: 30 },
});
