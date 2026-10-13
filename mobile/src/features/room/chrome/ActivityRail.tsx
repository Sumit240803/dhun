import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';

import { useTranslation } from '@/i18n';
import { colors, duration, radius, spacing } from '@/theme';
import { Row, Text } from '@/ui';

export interface RoomRank {
  /** `Hour`, `Pop`, `Daily` — the board this is a position on. */
  board: string;
  /** `100+`, `No.9` — shown verbatim; the server owns the wording. */
  position: string;
  /** 0..1 toward the next position. Null hides the bar but keeps the pill. */
  progress: number | null;
}

interface Props {
  rank: RoomRank | null;
  /** Shown so somebody can report a room, or be told which one they are in. */
  roomCode: string;
  onRulesPress: () => void;
  onRankPress: () => void;
}

/**
 * The second line: where this room stands, and what it is called.
 *
 * ── Why this row exists at all ──────────────────────────────────────────────
 *
 * It is the single biggest difference between our room and the references, and
 * it is not decoration. A host who can see they are 12% short of the next hourly
 * position has a reason to ask the room for one more gift, and that ask is the
 * mechanic the whole rail serves. A room with no rail is a room with nothing at
 * stake between gifts.
 *
 * Every item is a pill with a number in it. None of it is art.
 *
 * ── The room code ───────────────────────────────────────────────────────────
 *
 * The references print a numeric room ID here and people quote it constantly —
 * in reports, in WhatsApp, to find each other. Ours is a UUID, so the first
 * block is shown rather than the whole thing: short enough to read aloud and
 * still unique inside any conversation about one room.
 */
export function ActivityRail({ rank, roomCode, onRulesPress, onRankPress }: Props) {
  const { t } = useTranslation();

  return (
    <Row gap="xs" align="center">
      {rank !== null && (
        <Pressable
          onPress={onRankPress}
          accessibilityRole="button"
          accessibilityLabel={t('room.rankLabel', { board: rank.board, position: rank.position })}
          style={styles.rank}
          testID="room-rank"
        >
          <Ionicons name="flame" size={10} color={colors.brand.accent} />
          <Text variant="micro" tone="onMedia" style={styles.pillText}>
            {rank.board} {rank.position}
          </Text>
          {rank.progress !== null && <ProgressPip progress={rank.progress} />}
        </Pressable>
      )}

      <Pressable
        onPress={onRulesPress}
        accessibilityRole="button"
        accessibilityLabel={t('room.rules')}
        style={styles.pill}
        testID="room-rules"
      >
        <Ionicons name="document-text-outline" size={10} color={colors.text.onMedia} />
        <Text variant="micro" tone="onMedia" style={styles.pillText}>
          {t('room.rules')}
        </Text>
      </Pressable>

      <View style={styles.spacer} />

      <Text variant="micro" tone="onMedia" style={styles.code} numberOfLines={1}>
        {t('room.idLabel', { code: roomCode })}
      </Text>
    </Row>
  );
}

/** A thin bar inside the rank pill. Animates so progress reads as movement. */
function ProgressPip({ progress }: { progress: number }) {
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(Math.min(1, Math.max(0, progress)), { duration: duration.slow });
  }, [progress, width]);

  const style = useAnimatedStyle(() => ({ flex: Math.max(0.001, width.value) }));

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressFill, style]} />
      <View style={styles.progressRest} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
  rank: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
  pillText: { fontSize: 9, lineHeight: 12 },
  progressTrack: {
    flexDirection: 'row',
    width: 28,
    height: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.bg.onMediaWell,
  },
  progressFill: { backgroundColor: colors.brand.accent },
  progressRest: { flex: 1 },
  spacer: { flex: 1 },
  code: { fontSize: 9, lineHeight: 12, opacity: 0.6 },
});
