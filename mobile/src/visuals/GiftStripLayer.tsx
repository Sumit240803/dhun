// The lanes, drawn.
//
// An overlay across the top of the room's stage, below the header. It owns no
// state of its own — the lanes live in a `GiftStripLanes` the room screen
// creates, because gifts arrive over the room's socket and the screen is what
// holds that.

import { useCallback, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing, zIndex } from '@/theme';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { GiftStrip, STRIP_GAP, STRIP_HEIGHT } from './GiftStrip';
import type { GiftStripLanes } from './giftStrips';

interface Props {
  lanes: GiftStripLanes;
  /** Where the stack starts — the bottom edge of the room header. */
  top: number;
  hostId: string | undefined;
}

export function GiftStripLayer({ lanes, top, hostId }: Props) {
  // Read directly rather than mirrored into state: mirroring would mean a
  // setState in an effect on every gift, and a cascading re-render each time.
  const strips = useSyncExternalStore(lanes.subscribe, lanes.getSnapshot, lanes.getSnapshot);

  const release = useCallback((key: string) => lanes.release(key), [lanes]);

  if (strips.length === 0) return null;

  return (
    // `none`: strips are decoration over live controls. A strip passing over
    // a seat must never swallow the tap meant for it — in a room where people
    // gift constantly, that would make the seats feel broken.
    <View pointerEvents="none" style={[styles.layer, { top: top + spacing.sm }]}>
      {/* Its own boundary with no fallback. A strip that throws loses one
          strip, not the room and the audio underneath it. */}
      <ErrorBoundary screen="room.giftStrips" fallback={() => null}>
        {strips.map((strip) => (
          <View
            key={strip.key}
            style={[styles.lane, { top: strip.lane * (STRIP_HEIGHT + STRIP_GAP) }]}
          >
            <GiftStrip strip={strip} hostId={hostId} onExited={release} />
          </View>
        ))}
      </ErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: zIndex.giftStrip,
    elevation: zIndex.giftStrip,
  },
  lane: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
  },
});
