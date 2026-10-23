// The way back into the new-user sheet after it has been closed.
//
// A small chest floating above the Go Live button on the home feed, with the
// time left under it. It exists for exactly as long as the window does — the
// server stops returning the sheet at signup + 7 days and this goes with it.

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useNewUserRewards } from '@/api/queries/useGrowth';
import { useTranslation } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useIsRegistered } from '@/store/session';
import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui';
import { useCountdown } from './countdown';
import { newUserSheet } from './sheetStore';

/** Clears the Fab (56) and its own bottom offset. */
const ABOVE_FAB = spacing.lg + 56 + spacing.md;

export function NewUserEntry() {
  const { t } = useTranslation();
  const isRegistered = useIsRegistered();
  const { data } = useNewUserRewards(isRegistered);
  const remaining = useCountdown(data?.endsAt ?? null, data?.clockOffsetMs ?? 0);

  if (!data || remaining.ms === 0) return null;

  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.wrapper}>
      <Pressable
        onPress={() => {
          haptic.selection();
          newUserSheet.open();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('newUser.open')}
        testID="new-user-entry"
        style={({ pressed }) => pressed && styles.pressed}
      >
        <LinearGradient
          colors={[colors.promo.headerStart, colors.promo.headerEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.disc}
        >
          <Ionicons name="gift" size={26} color={colors.currency.coin} />
        </LinearGradient>
        <View style={styles.time}>
          <Text variant="micro" tone="onMedia" style={styles.timeText}>
            {t('newUser.countdownShort', remaining)}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', right: spacing.lg, bottom: ABOVE_FAB, alignItems: 'center' },
  disc: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.currency.coin,
  },
  time: {
    marginTop: -spacing.sm,
    alignSelf: 'center',
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.promo.cta,
  },
  timeText: { fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.7 },
});
