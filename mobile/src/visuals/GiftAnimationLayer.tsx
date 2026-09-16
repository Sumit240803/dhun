import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { absoluteFill, zIndex } from '@/theme';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { GiftAnimation } from './GiftAnimation';
import type { GiftQueue } from './giftQueue';

/**
 * The overlay that plays queued gifts above a room.
 *
 * Mount this ONCE per room, above the stage and the chat. The QUEUE belongs to
 * the room screen, like the strip lanes do: gifts arrive over the room's socket
 * and from the sender's own send, and both go straight into it with
 * `enqueue()` + `next()` — no React state in between, so a gift storm does not
 * re-render the room once per gift. The queue is what guarantees two
 * full-screen gifts never overlap, which is the most common way these apps look
 * broken during a whale moment.
 *
 * Wrapped in its own ErrorBoundary with a null fallback: if an animation throws,
 * the room and its audio keep running and only the effect is lost. A single
 * top-level boundary would take the whole stream down instead.
 */

export interface GiftAnimationLayerProps {
  queue: GiftQueue;
}

export function GiftAnimationLayer({ queue }: GiftAnimationLayerProps) {
  // Read the queue directly rather than mirroring it into component state.
  // Mirroring would mean setState inside an effect on every gift, and a
  // cascading re-render each time — measurable during a storm.
  const current = useSyncExternalStore(queue.subscribe, queue.getCurrent, queue.getCurrent);

  const advance = useCallback(() => {
    queue.finish();
    queue.next();
  }, [queue]);

  // Leaving the room abandons its queue; a gift must never follow you out.
  useEffect(() => () => queue.clear(), [queue]);

  if (!current) return null;

  return (
    <View style={styles.layer} pointerEvents="none">
      <ErrorBoundary screen="room.giftAnimation" fallback={() => null}>
        <GiftAnimation key={current.id} gift={current} onComplete={advance} />
      </ErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...absoluteFill,
    // Above room chrome, below sheets and modals. Centralised in theme/tokens so
    // a Tier 5 Galaxy can never end up rendering behind the chat overlay.
    zIndex: zIndex.giftFullscreen,
  },
});
