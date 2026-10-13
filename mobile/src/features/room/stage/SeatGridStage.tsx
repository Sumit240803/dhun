import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';
import { Column } from '@/ui';

import { seatGridLayout, type SeatTotals, type StageSlot } from '@/features/room/model';
import { SeatTile } from './SeatTile';

interface Props {
  slots: StageSlot[];
  capacity: number;
  /** User ids currently producing audio, from LiveKit. */
  speaking: string[];
  totals: SeatTotals;
  onSeatPress: (slot: StageSlot) => void;
}

/**
 * A party room: every seat on screen at once.
 *
 * ── Why the host is not pulled out of the grid ───────────────────────────────
 *
 * Some references give the host a larger tile above the grid; others leave them
 * in seat 0. We keep them in the grid, wearing the live ring, for one reason:
 * the grid is the room's seating plan, and a host hoisted out of it leaves a
 * hole where seat 0 should be, which is confusing in exactly the rooms where it
 * matters — the ones where people are asking for a specific seat by number.
 *
 * The ring and the crown do the work the size was doing.
 *
 * ── Why this is a wrapped row and not a FlatList ─────────────────────────────
 *
 * The capacity ceiling is twenty. All twenty are on screen, all are animating,
 * and virtualising twenty cells costs more than it saves — a FlatList here
 * would add a scroll container that fights the room's own layout.
 */
export function SeatGridStage({ slots, capacity, speaking, totals, onSeatPress }: Props) {
  const layout = seatGridLayout(capacity);
  const speakingSet = new Set(speaking);

  return (
    <Column gap="sm" style={styles.root}>
      <View style={[styles.grid, { gap: layout.gap, maxWidth: gridWidth(layout.columns, layout) }]}>
        {slots.map((slot) => (
          <SeatTile
            key={slot.seatIndex}
            slot={slot}
            layout={layout}
            speaking={slot.kind === 'taken' && speakingSet.has(slot.userId)}
            coins={slot.kind === 'taken' ? totals.get(slot.userId) : undefined}
            onPress={onSeatPress}
          />
        ))}
      </View>
    </Column>
  );
}

/**
 * The width that forces exactly `columns` per row.
 *
 * Wrapping is what lays the grid out, so the container has to be narrow enough
 * that a (columns + 1)th seat cannot fit. Without this a wide phone silently
 * puts four seats on a row meant for three, and the numbering stops matching
 * what anybody describes in chat.
 */
function gridWidth(columns: number, layout: { avatar: number; gap: number }): number {
  return columns * (layout.avatar + layout.gap) + (columns - 1) * layout.gap;
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingVertical: spacing.sm },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
});
