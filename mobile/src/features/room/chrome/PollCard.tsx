import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import type { PollView } from '@/api/types';
import { clock, pollLeader, pollOver, pollSecondsLeft, pollShares } from '@/features/room/polls';
import { useTranslation } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Row, Text } from '@/ui';

interface Props {
  poll: PollView;
  /** The host or an admin: may close it early. */
  canManage: boolean;
  /** Registered viewers vote; guests see the tallies. */
  canVote: boolean;
  pending: boolean;
  onVote: (optionIndex: number) => void;
  onClose: () => void;
  onDismiss: () => void;
}

/**
 * The poll, between the stage and the chat.
 *
 * One tap votes; the bars fill with everyone's share and the reader's own
 * choice is marked. The clock counts down on the client from `endsAt` — the
 * server never sends a "tick". When it is over, the leader is highlighted and
 * the card can be dismissed; it never blocks the chat for long.
 */
export function PollCard({ poll, canManage, canVote, pending, onVote, onClose, onDismiss }: Props) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const over = pollOver(poll, now);
  const shares = pollShares(poll);
  const leader = over ? pollLeader(poll) : null;
  const left = pollSecondsLeft(poll, now);

  return (
    <Animated.View entering={FadeInDown.duration(200)} style={styles.card} testID="poll-card">
      <Row justify="between" align="center">
        <Row gap="xs" align="center" style={styles.titleRow}>
          <Ionicons name="stats-chart" size={13} color={colors.text.onMedia} />
          <Text variant="caption" tone="onMedia" numberOfLines={2} style={styles.question}>
            {poll.question}
          </Text>
        </Row>
        <Text variant="micro" tone="onMedia" style={styles.clock}>
          {over ? t('room.pollEnded') : clock(left)}
        </Text>
      </Row>

      <View style={styles.options}>
        {poll.options.map((option, index) => {
          const mine = poll.myVote === index;
          const won = leader === index;
          const pct = Math.round(shares[index] * 100);
          return (
            <Pressable
              key={index}
              onPress={() => {
                if (over || !canVote || pending) return;
                haptic.selection();
                onVote(index);
              }}
              disabled={over || !canVote || pending}
              accessibilityRole="button"
              accessibilityState={{ selected: mine, disabled: over || !canVote }}
              accessibilityLabel={`${option.text}, ${pct}%`}
              style={styles.option}
              testID={`poll-option-${index}`}
            >
              <Animated.View
                entering={FadeIn.duration(160)}
                style={[
                  styles.fill,
                  { width: `${Math.max(pct, poll.total === 0 ? 0 : 2)}%` },
                  (mine || won) && styles.fillMine,
                ]}
              />
              <Row justify="between" align="center" style={styles.optionRow}>
                <Row gap="xs" align="center" style={styles.optionText}>
                  {mine && (
                    <Ionicons name="checkmark-circle" size={12} color={colors.text.onMedia} />
                  )}
                  <Text variant="micro" tone="onMedia" numberOfLines={1}>
                    {option.text}
                  </Text>
                </Row>
                <Text variant="micro" tone="onMedia">
                  {pct}%
                </Text>
              </Row>
            </Pressable>
          );
        })}
      </View>

      <Row justify="between" align="center">
        <Text variant="micro" tone="onMedia" style={styles.votes}>
          {t('room.pollVotes', { count: poll.total })}
        </Text>
        {over ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            hitSlop={spacing.sm}
            testID="poll-dismiss"
          >
            <Text variant="micro" tone="onMedia">
              {t('common.dismiss')}
            </Text>
          </Pressable>
        ) : canManage ? (
          <Pressable
            onPress={() => {
              haptic.tap();
              onClose();
            }}
            accessibilityRole="button"
            hitSlop={spacing.sm}
            testID="poll-close"
          >
            <Text variant="micro" tone="onMedia">
              {t('room.pollClose')}
            </Text>
          </Pressable>
        ) : null}
      </Row>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.bg.videoScrim,
  },
  titleRow: { flex: 1 },
  question: { flex: 1 },
  clock: { opacity: 0.85 },
  options: { gap: 4 },
  option: {
    height: 24,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.glass.fillStrong,
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.glass.fillStrong,
  },
  fillMine: { backgroundColor: colors.brand.solid },
  optionRow: { paddingHorizontal: spacing.sm },
  optionText: { flex: 1 },
  votes: { opacity: 0.8 },
});
