import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui';
import { LookAvatar } from '@/visuals/LookAvatar';

import type { StageOccupant } from '@/features/room/model';
import { RemoteVideo } from './RemoteVideo';

interface Props {
  occupant: StageOccupant;
  speaking: boolean;
  /** Coins gifted to this person in the room. Shown as a small chip. */
  coins: number | undefined;
  /** Hides the audio of the other side in a PK, or a guest in a video room. */
  muted?: boolean;
  onPress: (occupant: StageOccupant) => void;
  onToggleMute?: () => void;
  testID?: string;
}

/**
 * One person on camera.
 *
 * Falls back to their avatar on a tinted panel when there is no video track —
 * which is the common case, not the edge case. A host joins before their camera
 * does, a guest's connection drops, and an audio-only participant in a video
 * room never had one. A black rectangle in any of those reads as broken.
 *
 * The name and counters sit over the bottom of the tile under a scrim, because
 * the tile IS the picture: there is no room beside it for chrome.
 */
export function VideoTile({
  occupant,
  speaking,
  coins,
  muted,
  onPress,
  onToggleMute,
  testID,
}: Props) {
  const { t } = useTranslation();
  const name = occupant.displayName ?? '—';

  return (
    <View style={[styles.tile, speaking && styles.speaking]} testID={testID}>
      <RemoteVideo
        userId={occupant.userId}
        fallback={<LookAvatar name={name} size={72} frame={occupant.look?.frame} />}
      />

      {/* Bottom strip: who this is, and what they have been given. */}
      <View style={styles.footer} pointerEvents="box-none">
        <View style={styles.nameChip}>
          {occupant.isHost && <Ionicons name="star" size={9} color={colors.text.onBrand} />}
          <Text variant="micro" tone="onMedia" numberOfLines={1} style={styles.nameText}>
            {name}
          </Text>
        </View>

        {coins !== undefined && coins > 0 && (
          <View style={styles.coinChip}>
            <Ionicons name="gift" size={9} color={colors.text.onBrand} />
            <Text variant="micro" tone="onMedia">
              {coins}
            </Text>
          </View>
        )}
      </View>

      {occupant.muted && (
        <View style={styles.hostMuted}>
          <Ionicons name="mic-off" size={11} color={colors.text.onMedia} />
        </View>
      )}

      {/* Muting the OTHER side is a viewer's own control and never leaves the
          device — distinct from the host's mute above, which silences someone
          for the whole room. Two different things, two different icons. */}
      {onToggleMute && (
        <View
          accessibilityRole="button"
          accessibilityLabel={muted ? t('room.unmuteSide') : t('room.muteSide')}
          onTouchEnd={onToggleMute}
          style={styles.localMute}
        >
          <Ionicons
            name={muted ? 'volume-mute' : 'volume-high'}
            size={13}
            color={colors.text.onMedia}
          />
        </View>
      )}

      {/* The whole tile opens the profile card. Last, so the chips above win
          a tap that lands on them. */}
      <View
        accessibilityRole="button"
        accessibilityLabel={name}
        onTouchEnd={() => onPress(occupant)}
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.bg.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speaking: { borderWidth: 2, borderColor: colors.brand.accent },
  footer: {
    position: 'absolute',
    left: spacing.xs,
    right: spacing.xs,
    bottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  nameChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: '70%',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
  nameText: { flexShrink: 1 },
  coinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.solid,
  },
  hostMuted: {
    position: 'absolute',
    left: spacing.xs,
    top: spacing.xs,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.status.danger,
  },
  localMute: {
    position: 'absolute',
    right: spacing.xs,
    top: spacing.xs,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
});
