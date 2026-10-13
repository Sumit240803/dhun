import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';

import type { SeatTotals, StageOccupant } from '@/features/room/model';
import { MicRail } from './MicRail';
import { VideoTile } from './VideoTile';

interface Props {
  tiles: StageOccupant[];
  micRail: StageOccupant[];
  speaking: string[];
  totals: SeatTotals;
  onOccupantPress: (occupant: StageOccupant) => void;
}

/**
 * One or two people on camera, everyone else down the right edge.
 *
 * ── Why one tile and two tiles are the same component ───────────────────────
 *
 * The references show both, constantly, and a host goes from one to two the
 * moment a guest accepts. If those were separate stages the transition would
 * unmount the host's video and remount it, which drops the track and black
 * frames the person everybody is watching. One component, a flex row, and the
 * second tile simply appears.
 *
 * The mic rail is drawn over the tiles, not beside them, for the same reason it
 * exists at all: the video is the content, and squeezing it to make a column
 * would shrink the faces to make room for smaller faces.
 */
export function VideoStage({ tiles, micRail, speaking, totals, onOccupantPress }: Props) {
  const speakingSet = new Set(speaking);

  return (
    <View style={styles.root}>
      <View style={styles.tiles}>
        {tiles.map((occupant) => (
          <VideoTile
            key={occupant.userId}
            occupant={occupant}
            speaking={speakingSet.has(occupant.userId)}
            coins={totals.get(occupant.userId)}
            onPress={onOccupantPress}
            testID={`video-tile-${occupant.userId}`}
          />
        ))}
      </View>

      <MicRail occupants={micRail} speaking={speaking} totals={totals} onPress={onOccupantPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // A hairline between tiles rather than a gap: the references butt them edge
  // to edge, and a gap showing the backdrop through the middle of a PK reads
  // as two separate videos rather than one contest.
  tiles: { flex: 1, flexDirection: 'row', gap: StyleSheet.hairlineWidth * 2 },
  spacer: { width: spacing.xs },
});
