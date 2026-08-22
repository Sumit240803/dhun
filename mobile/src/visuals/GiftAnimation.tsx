import LottieView from 'lottie-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { absoluteFill, colors, radius, spacing } from '@/theme';
import { Text } from '@/ui/Text';
import { loadLottie } from './assets';
import type { QueuedGift } from './giftQueue';

/**
 * Renders one gift.
 *
 * **Three-step fallback, always:** animation → text card → nothing that crashes.
 *
 * A user who paid ₹282 for a Yacht and sees a blank screen will not pay again,
 * and a throw inside this component would take the room down with it — including
 * the host's video. So every failure path here ends in something drawn.
 */

export interface GiftAnimationProps {
  gift: QueuedGift;
  /** Called on finish, on failure, and on timeout — the queue advances on all three. */
  onComplete: () => void;
}

export function GiftAnimation({ gift, onComplete }: GiftAnimationProps) {
  const [source, setSource] = useState<unknown | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    loadLottie(gift.animationAsset).then((json) => {
      if (!active) return;
      if (json) setSource(json);
      else setFailed(true);
    });

    return () => {
      active = false;
    };
  }, [gift.animationAsset]);

  // Hard timeout. A Lottie that never fires onAnimationFinish — a malformed
  // export, a loop flag left on — would otherwise wedge the queue permanently
  // and no further gift would ever play in that room.
  useEffect(() => {
    const timer = setTimeout(onComplete, 8_000);
    return () => clearTimeout(timer);
  }, [gift.id, onComplete]);

  // Fallback card. Still celebratory: it names the sender, the gift and the
  // combo, so the moment lands even without the animation.
  if (failed || !gift.animationAsset) {
    return (
      <View style={styles.fallback} pointerEvents="none">
        <View style={[styles.fallbackCard, { borderColor: colors.tier[tierKey(gift.tier)] }]}>
          <Text variant="heading" tone="onMedia">
            {gift.giftName}
          </Text>
          {gift.quantity > 1 && (
            <Text variant="title" style={{ color: colors.tier[tierKey(gift.tier)] }}>
              {t('gifting.combo', { count: gift.quantity })}
            </Text>
          )}
          <Text variant="caption" tone="secondary">
            {t('gifting.someoneSentGift', {
              sender: gift.senderName,
              gift: gift.giftName,
              host: gift.hostName,
            })}
          </Text>
        </View>
      </View>
    );
  }

  if (!source) return null; // still loading — nothing on screen beats a spinner here

  return (
    <View style={styles.container} pointerEvents="none">
      <LottieView
        source={source as never}
        autoPlay
        loop={false}
        onAnimationFinish={onComplete}
        // Failure surfaces as onComplete rather than an exception, so a broken
        // asset advances the queue instead of stalling it.
        onAnimationFailure={() => {
          setFailed(true);
        }}
        resizeMode="contain"
        style={styles.lottie}
      />
    </View>
  );
}

/** Clamps an out-of-range tier from an older or newer API version. */
function tierKey(tier: number): 1 | 2 | 3 | 4 | 5 {
  const clamped = Math.min(5, Math.max(1, Math.trunc(tier)));
  return clamped as 1 | 2 | 3 | 4 | 5;
}

const styles = StyleSheet.create({
  container: { ...absoluteFill, alignItems: 'center', justifyContent: 'center' },
  lottie: { width: '100%', height: '100%' },
  fallback: {
    ...absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  fallbackCard: {
    backgroundColor: colors.glass.scrim,
    borderWidth: 2,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
});
