import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { formatCompact } from '@/lib/money';
import { colors, duration, radius, spacing } from '@/theme';
import { Text } from '@/ui';

import { formatPkClock, pkBoundary, pkSecondsLeft, type PkState } from './types';

/**
 * The bar, the clock and the two multipliers.
 *
 * ── What this draws, straight off the references ────────────────────────────
 *
 *   ┌──────────────────────────────┬───────────────────────────┐
 *   │ 242                     »»»  │                       633 │  ← two fills
 *   └──────────────────────────────┴───────────────────────────┘
 *     Win x2  (2)        ⚡ 02:24          (2)  Win x4      🔇
 *
 * The boundary is the score RATIO, not an absolute scale, so a battle at
 * 200 vs 600 and one at 2,000,000 vs 6,000,000 look the same — which is right,
 * because what is being shown is who is winning.
 *
 * ── The one number that must never reach money ──────────────────────────────
 *
 * `winMultiplier` is drawn here and nowhere else. It scales the DISPLAYED score
 * only. A multiplier that reached the ledger would move the payout ratio on
 * every battle, and the ratio is set by one number. See `pk/types.ts`.
 */
export function PkScoreBar({ pk }: { pk: PkState }) {
  const { t } = useTranslation();
  const [left, right] = pk.sides;

  // A ticking CLOCK, with the remaining seconds derived from it.
  //
  // The obvious shape — store the seconds and set them on an interval — has to
  // re-sync whenever `pk` changes, which means writing state from an effect for
  // a value that was always derivable. The deadline is absolute, so seconds
  // left is a pure function of (deadline, now); only `now` is state.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = pkSecondsLeft(pk, now);

  // The boundary SLIDES. Jumping it on every gift makes a busy battle flicker,
  // and the slide is also what communicates momentum — the thing the audience
  // is paying to change.
  const boundary = useSharedValue(pkBoundary(pk));
  useEffect(() => {
    boundary.value = withTiming(pkBoundary(pk), { duration: duration.normal });
  }, [pk, boundary]);

  const leftFill = useAnimatedStyle(() => ({ flex: boundary.value }));
  const rightFill = useAnimatedStyle(() => ({ flex: 1 - boundary.value }));

  const urgent = seconds <= 10 && pk.phase === 'live';

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Animated.View style={[styles.fill, styles.fillLeft, leftFill]}>
          <Text variant="micro" tone="onMedia" style={styles.score} numberOfLines={1}>
            {formatCompact(left.score)}
          </Text>
        </Animated.View>

        <Boundary />

        <Animated.View style={[styles.fill, styles.fillRight, rightFill]}>
          <Text
            variant="micro"
            tone="onMedia"
            style={[styles.score, styles.scoreRight]}
            numberOfLines={1}
          >
            {formatCompact(right.score)}
          </Text>
        </Animated.View>
      </View>

      <View style={styles.meta}>
        <Multiplier side="left" streak={left.streak} multiplier={left.winMultiplier} />

        <View style={[styles.clock, urgent && styles.clockUrgent]}>
          <Ionicons name="flash" size={10} color={colors.text.onMedia} />
          <Text variant="micro" tone="onMedia" style={styles.clockText}>
            {pk.phase === 'warmup' ? t('room.pkStartsIn') : formatPkClock(seconds)}
          </Text>
        </View>

        <Multiplier side="right" streak={right.streak} multiplier={right.winMultiplier} />
      </View>
    </View>
  );
}

/**
 * The marker where the two sides meet.
 *
 * Code-drawn chevrons until `rooms/pk/boundary` exists — see `roomAssets.ts`.
 * They pulse toward whichever side is gaining, which is the one job the real
 * asset will have too, so swapping it changes the art and not the behaviour.
 */
function Boundary() {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(1, { duration: 600 }), withTiming(0, { duration: 600 })),
      -1,
      false,
    );
  }, [pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * 0.55,
    transform: [{ translateX: pulse.value * 3 }],
  }));

  return (
    <Animated.View style={[styles.boundary, style]} pointerEvents="none">
      <Ionicons name="chevron-forward" size={11} color={colors.text.onMedia} />
    </Animated.View>
  );
}

/** `Win x4` and its streak octagon. */
function Multiplier({
  side,
  streak,
  multiplier,
}: {
  side: 'left' | 'right';
  streak: number;
  multiplier: number;
}) {
  const { t } = useTranslation();
  if (multiplier <= 1 && streak <= 0) return <View style={styles.multiplierSpacer} />;

  const badge = (
    <View style={styles.streak}>
      <Text variant="micro" tone="onMedia" style={styles.streakText}>
        {streak}
      </Text>
    </View>
  );

  return (
    <View style={styles.multiplier}>
      {side === 'left' && (
        <Text variant="micro" tone="onMedia" style={styles.multiplierText}>
          {t('room.pkWinMultiplier', { multiplier })}
        </Text>
      )}
      {badge}
      {side === 'right' && (
        <Text variant="micro" tone="onMedia" style={styles.multiplierText}>
          {t('room.pkWinMultiplier', { multiplier })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  bar: { flexDirection: 'row', height: 18, alignItems: 'stretch' },
  fill: { justifyContent: 'center' },
  // Magenta and cyan, as the references use. Reserved currency colours are not
  // touched: a PK side is a team, not a balance.
  fillLeft: { backgroundColor: colors.pk.home, paddingLeft: spacing.sm },
  fillRight: { backgroundColor: colors.pk.away, paddingRight: spacing.sm },
  score: { fontSize: 10, lineHeight: 14 },
  scoreRight: { textAlign: 'right' },
  boundary: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.videoScrim,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  multiplier: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minWidth: 72 },
  multiplierSpacer: { minWidth: 72 },
  multiplierText: { fontSize: 10, lineHeight: 13 },
  streak: {
    width: 16,
    height: 16,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.solid,
  },
  streakText: { fontSize: 9, lineHeight: 12 },
  clock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
  clockUrgent: { backgroundColor: colors.status.danger },
  clockText: { fontVariant: ['tabular-nums'] },
});
