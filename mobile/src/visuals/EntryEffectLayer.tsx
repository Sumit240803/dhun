// An entrance, announced.
//
// A banner that slides in from the left across the lower stage, holds, and
// leaves — the name drawn by the app over the effect's art, never baked into
// it, because names are dynamic and often in Devanagari (asset contract § 5).
//
// The art is a 750×250 Lottie. Until it loads, or if it never does, the banner
// draws itself from the effect's accent colour, so an entrance someone paid for
// is never an empty strip.

import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { EntryView } from '@/api/types';
import { useTranslation } from '@/i18n';
import { absoluteFill, colors, duration, radius, spacing, zIndex } from '@/theme';
import { Text } from '@/ui';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { loadLottie } from './assets';
import type { EntryEffects } from './entryEffects';
import { onMedia } from './look';
import { LookAvatar } from './LookAvatar';

const SLIDE_MS = 280;
const BANNER_HEIGHT = 64;

interface Props {
  effects: EntryEffects;
  /** Distance from the bottom of the screen — above the room's bottom bar. */
  bottom: number;
}

export function EntryEffectLayer({ effects, bottom }: Props) {
  const current = useSyncExternalStore(effects.subscribe, effects.getCurrent, effects.getCurrent);

  // Leaving the room abandons its backlog.
  useEffect(() => () => effects.clear(), [effects]);

  if (!current?.look.entry) return null;

  return (
    <View pointerEvents="none" style={[styles.layer, { bottom }]}>
      <ErrorBoundary screen="room.entryEffect" fallback={() => null}>
        <EntryBanner key={current.userId} entry={current} onDone={() => effects.finish()} />
      </ErrorBoundary>
    </View>
  );
}

function EntryBanner({ entry, onDone }: { entry: EntryView; onDone: () => void }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const effect = entry.look.entry!;
  // The banner is dark whatever the app palette, so both come from the dark variant.
  const accent = onMedia(effect.style).accent;
  const nameColor = entry.look.nameColor ? onMedia(entry.look.nameColor).color : undefined;
  const name = entry.name ?? '—';

  const [art, setArt] = useState<unknown | null>(null);
  useEffect(() => {
    let active = true;
    void loadLottie(effect.asset).then((json) => {
      if (active && json) setArt(json);
    });
    return () => {
      active = false;
    };
  }, [effect.asset]);

  const x = useSharedValue(reduceMotion ? 0 : -320);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const hold = duration.entryEffect - SLIDE_MS * 2;
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(onDone);
    };

    x.set(
      withTiming(0, { duration: reduceMotion ? 0 : SLIDE_MS, easing: Easing.out(Easing.cubic) }),
    );
    opacity.set(
      withSequence(
        withTiming(1, { duration: SLIDE_MS }),
        withDelay(hold, withTiming(0, { duration: SLIDE_MS }, done)),
      ),
    );

    // A banner whose animation callback never fires must not hold the queue.
    const timer = setTimeout(onDone, duration.entryEffect + 1_000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ translateX: x.get() }],
  }));

  return (
    <Animated.View
      style={[styles.banner, style]}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('room.entered', { name })}
    >
      {art ? (
        <LottieView
          source={art as never}
          autoPlay
          loop={false}
          resizeMode="cover"
          style={styles.art}
        />
      ) : (
        <LinearGradient
          // The accent fading out to transparent, so the banner reads as light
          // on the stage rather than a solid block across it.
          colors={[accent, `${accent}00`]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.art}
        />
      )}

      <LookAvatar uri={entry.avatarUrl} name={name} size="sm" frame={entry.look.frame} />
      <View style={styles.text}>
        <Text
          variant="bodyStrong"
          numberOfLines={1}
          style={[styles.name, nameColor ? { color: nameColor } : null]}
        >
          {name}
        </Text>
        <Text variant="micro" style={styles.caption}>
          {t('room.enteredCaption')}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.xxxl,
    zIndex: zIndex.entryEffect,
    elevation: zIndex.entryEffect,
  },
  banner: {
    height: BANNER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.bg.videoScrim,
  },
  art: { ...absoluteFill },
  text: { flexShrink: 1, minWidth: 0 },
  name: { color: colors.text.onMedia },
  caption: { color: colors.text.onMedia, opacity: 0.85 },
});
