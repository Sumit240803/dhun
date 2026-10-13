import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { formatCompact } from '@/lib/money';
import { colors, radius, spacing } from '@/theme';
import { Avatar, Column, Text } from '@/ui';

import type { SeatTotals, StageOccupant } from '@/features/room/model';
import { MicRail } from '@/features/room/stage/MicRail';
import { RemoteVideo } from '@/features/room/stage/RemoteVideo';
import { PkScoreBar } from './PkScoreBar';
import { pkLeader, type PkSide, type PkState, type PkSupporter } from './types';

interface Props {
  pk: PkState;
  micRail: StageOccupant[];
  speaking: string[];
  totals: SeatTotals;
  onOccupantPress: (occupant: StageOccupant) => void;
}

/**
 * Two hosts, one bar, one clock.
 *
 * ── Layout, from the references ─────────────────────────────────────────────
 *
 *   ════════════ score bar, clock, multipliers ════════════
 *   ┌───────────────────────┬───────────────────────┐
 *   │                       │                       │
 *   │     host A's camera   │    host B's camera    │
 *   │                       │                       │
 *   │  ◯◯◯◯ supporters      │      supporters ◯◯◯◯  │
 *   └───────────────────────┴───────────────────────┘
 *
 * The supporter rows are not decoration. Being one of the four faces under the
 * host you backed is most of why the fifth-biggest gifter sends a sixth gift,
 * and they update live as the battle runs.
 *
 * ── What this stage deliberately does NOT do ────────────────────────────────
 *
 * It does not settle anything. No gift is pooled, no gift is returned, and the
 * winner receives nothing but a streak badge — see the second rule in
 * `pk/types.ts`. This component shows a scoreboard; the ledger has already paid
 * every gift to the host it was sent to, battle or no battle.
 */
export function PkStage({ pk, micRail, speaking, totals, onOccupantPress }: Props) {
  const { t } = useTranslation();
  const leader = pkLeader(pk);

  // Muting the OTHER side is a local comfort — two hosts shouting over each
  // other is the normal state of a PK — and it never leaves the device.
  const [mutedSide, setMutedSide] = useState<0 | 1 | null>(null);

  return (
    <View style={styles.root}>
      <PkScoreBar pk={pk} />

      <View style={styles.tiles}>
        {pk.sides.map((side, index) => (
          <SideTile
            key={side.userId}
            side={side}
            index={index as 0 | 1}
            leading={leader === index}
            speaking={speaking.includes(side.userId)}
            muted={mutedSide === index}
            onToggleMute={() =>
              setMutedSide((current) => (current === index ? null : (index as 0 | 1)))
            }
            onPress={() =>
              onOccupantPress({
                seatIndex: -1,
                userId: side.userId,
                displayName: side.displayName,
                muted: false,
                look: null,
                isHost: true,
              })
            }
          />
        ))}
      </View>

      {pk.phase === 'result' && (
        <Animated.View entering={ZoomIn.duration(260)} style={styles.result} pointerEvents="none">
          <Ionicons
            name={pk.winner === null ? 'remove-circle' : 'trophy'}
            size={28}
            color={colors.text.onMedia}
          />
          <Text variant="heading" tone="onMedia">
            {pk.winner === null
              ? t('room.pkDraw')
              : t('room.pkWinner', { name: pk.sides[pk.winner].displayName ?? '' })}
          </Text>
        </Animated.View>
      )}

      <MicRail occupants={micRail} speaking={speaking} totals={totals} onPress={onOccupantPress} />
    </View>
  );
}

function SideTile({
  side,
  index,
  leading,
  speaking,
  muted,
  onToggleMute,
  onPress,
}: {
  side: PkSide;
  index: 0 | 1;
  leading: boolean;
  speaking: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const name = side.displayName ?? '—';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={[styles.tile, speaking && styles.tileSpeaking]}
      testID={`pk-side-${index}`}
    >
      <RemoteVideo
        userId={side.userId}
        fallback={
          <Column gap="xs" align="center">
            <Avatar name={name} uri={side.avatarUrl} size={64} />
            <Text variant="caption" tone="onMedia">
              {name}
            </Text>
          </Column>
        }
      />

      {/* The crown is on the side that is AHEAD, and moves when the lead
          changes. That movement is the cheapest drama in the whole screen. */}
      {leading && (
        <Animated.View entering={FadeIn.duration(180)} style={styles.crown}>
          <Ionicons name="trophy" size={11} color={colors.text.onBrand} />
        </Animated.View>
      )}

      <Pressable
        onPress={onToggleMute}
        accessibilityRole="button"
        accessibilityLabel={muted ? t('room.unmuteSide') : t('room.muteSide')}
        hitSlop={spacing.sm}
        style={[styles.mute, index === 0 ? styles.muteLeft : styles.muteRight]}
      >
        <Ionicons
          name={muted ? 'volume-mute' : 'volume-high'}
          size={13}
          color={colors.text.onMedia}
        />
      </Pressable>

      <Supporters supporters={side.supporters} align={index === 0 ? 'flex-start' : 'flex-end'} />
    </Pressable>
  );
}

/**
 * The four faces under a tile.
 *
 * Ranked, best first, and capped at four because a fifth does not fit under a
 * half-width tile at a size where a face is still a face.
 */
function Supporters({
  supporters,
  align,
}: {
  supporters: PkSupporter[];
  align: 'flex-start' | 'flex-end';
}) {
  if (supporters.length === 0) return null;

  return (
    <View style={[styles.supporters, { justifyContent: align }]} pointerEvents="none">
      {supporters.slice(0, 4).map((supporter, rank) => (
        <View key={supporter.userId} style={styles.supporter}>
          <Avatar name={supporter.displayName ?? '—'} uri={supporter.avatarUrl} size={24} />
          {rank === 0 && (
            <View style={styles.topSupporter}>
              <Text variant="micro" tone="onMedia" style={styles.topSupporterText}>
                {formatCompact(supporter.coins)}
              </Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tiles: { flex: 1, flexDirection: 'row', gap: StyleSheet.hairlineWidth * 2 },
  tile: {
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.scrim,
  },
  tileSpeaking: { borderWidth: 2, borderColor: colors.brand.accent },
  crown: {
    position: 'absolute',
    top: spacing.xs,
    alignSelf: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.solid,
  },
  mute: {
    position: 'absolute',
    top: spacing.xs,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
  muteLeft: { left: spacing.xs },
  muteRight: { right: spacing.xs },
  supporters: {
    position: 'absolute',
    left: spacing.xs,
    right: spacing.xs,
    bottom: spacing.xs,
    flexDirection: 'row',
    gap: 2,
  },
  supporter: { justifyContent: 'flex-end' },
  topSupporter: {
    position: 'absolute',
    bottom: -3,
    alignSelf: 'center',
    paddingHorizontal: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.solid,
  },
  topSupporterText: { fontSize: 8, lineHeight: 11 },
  result: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg.scrim,
  },
});
