import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInRight, LinearTransition } from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { formatCompact } from '@/lib/money';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui';
import { LookAvatar } from '@/visuals/LookAvatar';

import type { SeatTotals, StageOccupant } from '@/features/room/model';

interface Props {
  occupants: StageOccupant[];
  speaking: string[];
  totals: SeatTotals;
  onPress: (occupant: StageOccupant) => void;
}

/**
 * Everyone on mic who is not on a tile, down the right edge.
 *
 * This is the layout the references use most: one person on camera filling the
 * screen, and four or five more talking from a column on the right. Without it
 * a video room can only show two people, and the sixth guest is invisible.
 *
 * ── Why it collapses ────────────────────────────────────────────────────────
 *
 * The rail sits over the video, so at six people it is covering a third of the
 * host's face. The references put a chevron on it for exactly that reason. It
 * stays open by default — a collapsed rail hides who is in the room, which is
 * worse than covering some scenery — and remembers nothing, because the state
 * that matters is who is talking right now.
 */
export function MicRail({ occupants, speaking, totals, onPress }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const speakingSet = new Set(speaking);

  if (occupants.length === 0) return null;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {open && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {occupants.map((occupant) => {
            const name = occupant.displayName ?? '—';
            const coins = totals.get(occupant.userId);
            return (
              <Animated.View
                key={occupant.userId}
                entering={FadeInRight.duration(200)}
                layout={LinearTransition.duration(200)}
              >
                <Pressable
                  onPress={() => onPress(occupant)}
                  accessibilityRole="button"
                  accessibilityLabel={name}
                  style={[styles.card, speakingSet.has(occupant.userId) && styles.cardSpeaking]}
                  testID={`mic-rail-${occupant.userId}`}
                >
                  <LookAvatar name={name} size={34} frame={occupant.look?.frame} />

                  <View style={styles.meta}>
                    <Text variant="micro" tone="onMedia" numberOfLines={1} style={styles.name}>
                      {name}
                    </Text>
                    {coins !== undefined && coins > 0 && (
                      <Text variant="micro" tone="onMedia" style={styles.coins}>
                        {formatCompact(coins)}
                      </Text>
                    )}
                  </View>

                  {occupant.muted && (
                    <View style={styles.muted}>
                      <Ionicons name="mic-off" size={9} color={colors.text.onMedia} />
                    </View>
                  )}
                </Pressable>
              </Animated.View>
            );
          })}
        </ScrollView>
      )}

      <Pressable
        onPress={() => {
          haptic.tap();
          setOpen((value) => !value);
        }}
        accessibilityRole="button"
        accessibilityLabel={open ? t('room.railCollapse') : t('room.railExpand')}
        style={styles.toggle}
        hitSlop={spacing.sm}
        testID="mic-rail-toggle"
      >
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.text.onMedia}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    right: spacing.xs,
    top: spacing.sm,
    bottom: spacing.sm,
    width: 92,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  // Capped rather than filling the stage: past five cards the rail is the
  // stage, and the person on camera is who everybody came for.
  scroll: { maxHeight: 220, width: '100%' },
  list: { gap: spacing.xs },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: 3,
    paddingRight: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
  cardSpeaking: { borderWidth: 1, borderColor: colors.brand.accent },
  meta: { flex: 1, minWidth: 0 },
  name: { fontSize: 9, lineHeight: 12 },
  coins: { fontSize: 9, lineHeight: 12, opacity: 0.7 },
  muted: {
    padding: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.status.danger,
  },
  toggle: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
});
