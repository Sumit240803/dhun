import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { colors, spacing } from '@/theme';
import { Column, Text } from '@/ui';
import { LookAvatar } from '@/visuals/LookAvatar';

import { PkStage } from '@/features/room/pk/PkStage';
import type { SeatTotals, StageModel, StageOccupant, StageSlot } from '@/features/room/model';
import { SeatGridStage } from './SeatGridStage';
import { VideoStage } from './VideoStage';

interface Props {
  model: StageModel;
  speaking: string[];
  totals: SeatTotals;
  /** A taken seat, a tile or a rail card was tapped. Opens the profile card. */
  onOccupantPress: (occupant: StageOccupant) => void;
  /** An empty seat was tapped. Asks for the mic, or takes it if we are the host. */
  onVacancyPress: (seatIndex: number) => void;
}

/**
 * The middle of the room.
 *
 * ── Why this is a switch and not a tree of conditions ───────────────────────
 *
 * Six room types share one set of chrome and differ only here. `buildStage()`
 * has already decided which one this is; the switch's job is to be exhaustive,
 * and TypeScript enforces that — adding a seventh stage kind will not compile
 * until this file handles it. That is the whole reason the model is a tagged
 * union rather than a bag of optional fields.
 */
export function Stage({ model, speaking, totals, onOccupantPress, onVacancyPress }: Props) {
  function handleSlot(slot: StageSlot) {
    if (slot.kind === 'taken') onOccupantPress(slot);
    else onVacancyPress(slot.seatIndex);
  }

  switch (model.kind) {
    case 'pk':
      return (
        <PkStage
          pk={model.pk}
          micRail={model.micRail}
          speaking={speaking}
          totals={totals}
          onOccupantPress={onOccupantPress}
        />
      );

    case 'video':
      return (
        <VideoStage
          tiles={model.tiles}
          micRail={model.micRail}
          speaking={speaking}
          totals={totals}
          onOccupantPress={onOccupantPress}
        />
      );

    case 'seats':
      return (
        <SeatGridStage
          slots={model.slots}
          capacity={model.capacity}
          speaking={speaking}
          totals={totals}
          onSeatPress={handleSlot}
        />
      );

    case 'solo':
      return (
        <SoloStage
          host={model.host}
          speaking={model.host !== null && speaking.includes(model.host.userId)}
          coins={model.host ? totals.get(model.host.userId) : undefined}
          onPress={onOccupantPress}
        />
      );
  }
}

/**
 * A host alone, on audio.
 *
 * The smallest room there is, and the one most likely to look empty — so it
 * gets the host large and centred rather than a lonely seat grid of one. The
 * backdrop behind it is doing most of the work.
 */
function SoloStage({
  host,
  speaking,
  coins,
  onPress,
}: {
  host: StageOccupant | null;
  speaking: boolean;
  coins: number | undefined;
  onPress: (occupant: StageOccupant) => void;
}) {
  const { t } = useTranslation();
  if (host === null) return <View style={styles.solo} />;

  const name = host.displayName ?? '—';

  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.solo}>
      <Column gap="sm" align="center">
        <View accessibilityRole="button" accessibilityLabel={name} onTouchEnd={() => onPress(host)}>
          <LookAvatar name={name} size={96} frame={host.look?.frame} live={speaking} />
        </View>
        <Text variant="heading" tone="onMedia">
          {name}
        </Text>
        <Text variant="caption" tone="onMedia" style={styles.soloHint}>
          {coins !== undefined && coins > 0 ? t('room.soloEarned', { coins }) : t('room.soloHint')}
        </Text>
      </Column>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  solo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    backgroundColor: colors.bg.baseTransparent,
  },
  soloHint: { opacity: 0.7 },
});
