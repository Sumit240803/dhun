import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { isEnabled } from '@/config/flags';
import { getDevicePayload } from '@/features/auth/device';
import { adoptSession } from '@/features/auth/session';
import {
  MOCK,
  SOCIAL_PROVIDERS,
  signInWithProvider,
  type SocialProvider,
} from '@/features/auth/social';
import { useTranslation, type MessageKey } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorMessage, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Banner, Checkbox, Column, ProviderButton, Row, Screen, Text } from '@/ui';
import { Collage } from '@/visuals/Collage';

type IconName = keyof typeof Ionicons.glyphMap;

const PROVIDER_UI: Record<SocialProvider, { label: MessageKey; icon: IconName; tint?: string }> = {
  google: { label: 'auth.withGoogle', icon: 'logo-google' },
  facebook: { label: 'auth.withFacebook', icon: 'logo-facebook', tint: colors.provider.facebook },
  instagram: {
    label: 'auth.withInstagram',
    icon: 'logo-instagram',
    tint: colors.provider.instagram,
  },
};

export default function LoginScreen() {
  const { t } = useTranslation();
  const [consented, setConsented] = useState(false);
  const [consentNagged, setConsentNagged] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const nudge = useSharedValue(0);

  const social = useMutation({
    mutationFn: (provider: SocialProvider) => signInWithProvider(provider),
    onSuccess: async (session, provider) => {
      haptic.success();
      track('signup_started', { method: provider });
      await adoptSession(session);
      router.replace(session.user.displayName ? '/(app)/(tabs)' : '/(app)/profile-setup');
    },
    onError: () => haptic.error(),
  });

  const guest = useMutation({
    mutationFn: async () => authApi.createGuest(await getDevicePayload()),
    onSuccess: async (session) => {
      haptic.success();
      track('signup_started', { method: 'guest' });
      await adoptSession(session);
      router.replace('/(app)/(tabs)');
    },
    onError: () => haptic.error(),
  });

  useEffect(() => {
    if (!consentNagged) return;
    nudge.value = withSequence(
      withTiming(-5, { duration: 50 }),
      withTiming(5, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, [consentNagged, nudge]);

  const nudgeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));

  /**
   * Every sign-in path runs through here.
   *
   * The consent gate is not decoration: DPDP Act 2023 wants consent that is
   * freely given and specific, and a tick nobody was asked for is neither. The
   * nudge exists because a silently disabled button teaches nothing — the user
   * taps twice, then leaves.
   */
  function gated(action: () => void) {
    return () => {
      setNotice(null);
      if (!consented) {
        haptic.error();
        // Reset first, so a second tap re-triggers the animation.
        setConsentNagged(false);
        requestAnimationFrame(() => setConsentNagged(true));
        return;
      }
      haptic.tap();
      action();
    };
  }

  const busy = social.isPending || guest.isPending;
  const failure = social.error ?? guest.error;

  return (
    <Screen padded={false} edges={['top', 'bottom']}>
      <Collage />

      <View style={styles.help}>
        <Text variant="title" tone="brand" style={styles.wordmark}>
          {t('app.name')}
        </Text>
        <Link href="/legal/grievance" asChild>
          <Pressable accessibilityRole="button" hitSlop={spacing.sm}>
            <Text variant="caption" tone="secondary">
              {t('auth.needHelp')}
            </Text>
          </Pressable>
        </Link>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.spacer} />

        <Animated.View entering={FadeInDown.duration(360)} style={styles.panel}>
          {isEnabled('socialLoginEnabled') && (
            <Column gap="md">
              {SOCIAL_PROVIDERS.map((provider) => {
                const ui = PROVIDER_UI[provider];
                return (
                  <ProviderButton
                    key={provider}
                    label={t(ui.label)}
                    icon={
                      <Ionicons name={ui.icon} size={22} color={ui.tint ?? colors.text.primary} />
                    }
                    onPress={gated(() => social.mutate(provider))}
                    loading={social.isPending && social.variables === provider}
                    disabled={busy && social.variables !== provider}
                    testID={`provider-${provider}`}
                  />
                );
              })}
            </Column>
          )}

          <Row gap="md" style={styles.divider}>
            <View style={styles.rule} />
            <Text variant="micro" tone="faint">
              {t('auth.moreMethods')}
            </Text>
            <View style={styles.rule} />
          </Row>

          <Row gap="xxl" justify="center">
            <CircleMethod
              icon="phone-portrait-outline"
              label={t('auth.methodPhone')}
              onPress={gated(() => router.push('/(auth)/phone'))}
              testID="method-phone"
            />
            <CircleMethod
              icon="person-outline"
              label={t('auth.methodGuest')}
              onPress={gated(() => guest.mutate())}
              busy={guest.isPending}
              testID="method-guest"
            />
            <CircleMethod
              icon="mail-outline"
              label={t('auth.methodEmail')}
              // Email sign-in has no endpoint and no screen. Saying so beats a
              // button that navigates nowhere.
              onPress={gated(() => setNotice(t('auth.methodUnavailable')))}
              testID="method-email"
            />
          </Row>

          {(failure != null || notice !== null) && (
            <Banner
              message={failure != null ? errorMessage(failure) : notice!}
              detail={failure != null ? traceReference(failure) : undefined}
              tone={failure != null ? 'danger' : 'info'}
            />
          )}

          {MOCK && __DEV__ && (
            <Banner tone="warning" message="Social sign-in is mocked — creates a guest session." />
          )}

          <Animated.View style={[styles.consent, nudgeStyle]}>
            <Checkbox
              checked={consented}
              onChange={(next) => {
                haptic.selection();
                setConsented(next);
                if (next) setConsentNagged(false);
              }}
              accessibilityLabel={t('auth.consent', {
                terms: t('legal.terms'),
                privacy: t('legal.privacy'),
              })}
              testID="consent"
            >
              <ConsentLabel />
            </Checkbox>

            {consentNagged && !consented && (
              <Text variant="micro" tone="danger" style={styles.consentError}>
                {t('auth.consentRequired')}
              </Text>
            )}
          </Animated.View>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

/**
 * "I have read and agree to the Terms and Privacy Policy."
 *
 * Split from ONE translated sentence rather than assembled from pieces: Hindi
 * puts the verb last, so concatenating fragments produces word salad. The
 * placeholders keep the order wherever the translator puts them.
 */
function ConsentLabel() {
  const { t } = useTranslation();
  const parts = t('auth.consent').split(/(\{terms\}|\{privacy\})/);

  return (
    <Text variant="micro" tone="faint" style={styles.consentText}>
      {parts.map((part, index) => {
        if (part === '{terms}') {
          return (
            <Link key={index} href="/legal/terms" style={styles.link}>
              {t('legal.terms')}
            </Link>
          );
        }
        if (part === '{privacy}') {
          return (
            <Link key={index} href="/legal/privacy" style={styles.link}>
              {t('legal.privacy')}
            </Link>
          );
        }
        return part;
      })}
    </Text>
  );
}

function CircleMethod({
  icon,
  label,
  onPress,
  busy = false,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      style={styles.circleMethod}
    >
      {({ pressed }) => (
        <>
          <View style={[styles.circle, pressed && styles.circlePressed]}>
            <Ionicons name={icon} size={24} color={colors.text.onMedia} />
          </View>
          <Text variant="micro" tone="faint">
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  help: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  wordmark: { letterSpacing: -0.5 },
  scroll: { flexGrow: 1 },
  // Pushes the panel to the bottom on a tall screen while still allowing scroll
  // on a short one, which a plain flex:1 spacer inside a ScrollView will not do.
  spacer: { flexGrow: 1, minHeight: spacing.xxxl },
  panel: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.lg },
  divider: { alignItems: 'center' },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border.strong },
  circleMethod: { alignItems: 'center', gap: spacing.xs },
  circle: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.solid,
  },
  circlePressed: { backgroundColor: colors.brand.pressed },
  consent: { gap: spacing.xs, marginTop: spacing.sm },
  consentText: { lineHeight: 16 },
  consentError: { marginLeft: spacing.xl },
  link: { color: colors.brand.accent, textDecorationLine: 'underline' },
});
