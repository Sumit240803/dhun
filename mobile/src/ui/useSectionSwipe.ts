import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { haptic } from '@/lib/haptics';

/** How far a drag must travel before it counts as a section change. */
const DISTANCE_THRESHOLD = 60;
/** …or how fast, for a quick flick that never travels far. */
const VELOCITY_THRESHOLD = 500;

export interface SectionSwipeOptions<T extends string> {
  sections: T[];
  value: T;
  onChange: (next: T) => void;
  enabled?: boolean;
}

/**
 * Swipe left/right to move between the sections of a screen.
 *
 * This is deliberately for SECTIONS — Following ↔ Explore — and not for the
 * bottom tabs. Every app in this category works that way, and for a reason: a
 * screen-wide gesture that jumps between Messages and Me would fire constantly
 * by accident, and the bottom bar is already a one-tap target that shows where
 * you are. Sections have no such affordance beyond a small label, so the
 * gesture is doing real work there.
 *
 * The thresholds are what make it coexist with everything else on the screen:
 *
 * · `activeOffsetX` means the gesture does not claim the touch until it has
 *   travelled 24px horizontally, so a tap on a card still lands.
 * · `failOffsetY` kills it after 14px of vertical movement, so scrolling the
 *   feed never accidentally changes section.
 * · Distance OR velocity, so both a slow drag and a quick flick work — a
 *   distance-only rule feels broken to anyone who flicks.
 */
export function useSectionSwipe<T extends string>({
  sections,
  value,
  onChange,
  enabled = true,
}: SectionSwipeOptions<T>) {
  return useMemo(() => {
    function move(direction: -1 | 1) {
      const index = sections.indexOf(value);
      const next = sections[index + direction];
      // No wrapping. Swiping past the last section should feel like a wall,
      // not teleport you back to the first one.
      if (next === undefined) return;
      haptic.selection();
      onChange(next);
    }

    return Gesture.Pan()
      .enabled(enabled && sections.length > 1)
      .activeOffsetX([-24, 24])
      .failOffsetY([-14, 14])
      .onEnd((event) => {
        'worklet';
        const far = Math.abs(event.translationX) > DISTANCE_THRESHOLD;
        const fast = Math.abs(event.velocityX) > VELOCITY_THRESHOLD;
        if (!far && !fast) return;
        // Dragging left (negative) moves FORWARD, the way a page turns.
        runOnJS(move)(event.translationX < 0 ? 1 : -1);
      });
  }, [sections, value, onChange, enabled]);
}
