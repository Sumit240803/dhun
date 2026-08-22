import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { absoluteFill, zIndex } from '@/theme';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { GiftAnimation } from './GiftAnimation';
import { GiftQueue, needsQueue, type QueuedGift } from './giftQueue';

/**
 * The overlay that plays queued gifts above a room.
 *
 * Mount this ONCE per room, above the video and the chat. It owns the queue, so
 * two full-screen gifts can never overlap — which is the most common way these
 * apps look broken during a whale moment.
 *
 * Wrapped in its own ErrorBoundary with a null fallback: if an animation throws,
 * the room and the host's video keep running and only the effect is lost. A
 * single top-level boundary would take the whole stream down instead.
 */

export interface GiftAnimationLayerProps {
  /** Newest gift received. Push the same object once; the queue dedupes by id. */
  incoming?: QueuedGift | null;
  /** Room id — changing it clears the queue so a gift never follows you out. */
  roomId?: string;
}

export function GiftAnimationLayer({ incoming, roomId }: GiftAnimationLayerProps) {
  const queue = useMemo(() => new GiftQueue(), []);
  const lastEnqueued = useRef<string | null>(null);

  // Read the queue directly rather than mirroring it into component state.
  // Mirroring would mean setState inside an effect on every gift, and a
  // cascading re-render each time — measurable during a storm.
  const current = useSyncExternalStore(queue.subscribe, queue.getCurrent, queue.getCurrent);

  const advance = useCallback(() => {
    queue.finish();
    queue.next();
  }, [queue]);

  useEffect(() => {
    if (!incoming || incoming.id === lastEnqueued.current) return;
    lastEnqueued.current = incoming.id;

    // Tier 1-2 render inline in the message stream, not here. Queueing them
    // would block the screen behind a flood of Roses.
    if (!needsQueue(incoming.effect)) return;

    queue.enqueue(incoming);
    // Imperative, not setState — the store notifies and useSyncExternalStore
    // re-reads, so no cascading render.
    queue.next();
  }, [incoming, queue]);

  useEffect(() => {
    lastEnqueued.current = null;
    queue.clear();
  }, [roomId, queue]);

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
