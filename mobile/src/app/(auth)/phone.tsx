import { useMutation } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import {
  DIAL_CODE,
  formatNational,
  isValidNational,
  normaliseDigits,
  toE164,
} from '@/features/auth/phone';
import { adoptSession } from '@/features/auth/session';
import { getDevicePayload } from '@/features/auth/device';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorMessage, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Banner, Button, Column, Input, Screen, Text } from '@/ui';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const [digits, setDigits] = useState('');
  const [touched, setTouched] = useState(false);

  const isValid = isValidNational(digits);
  // Only complain once they have typed enough to have made a mistake. Showing
  // "enter a valid number" against an empty field is scolding someone for not
  // having started yet.
  const showInvalid = touched && digits.length === 10 && !isValid;

  const sendCode = useMutation({
    mutationFn: () => authApi.requestOtp(toE164(digits)),
    onSuccess: (result) => {
      haptic.success();
      track('otp_sent', { channel: result.channel });
      router.push({
        pathname: '/(auth)/otp',
        params: {
          phone: toE164(digits),
          expiresIn: String(result.expiresInSeconds),
          // Development only — the backend omits it in production. It is what
          // makes the flow testable before DLT registration clears.
          ...(result.devCode ? { devCode: result.devCode } : {}),
        },
      });
    },
    onError: () => haptic.error(),
  });

  const continueAsGuest = useMutation({
    mutationFn: async () => authApi.createGuest(await getDevicePayload()),
    onSuccess: async (session) => {
      await adoptSession(session);
      track('signup_started', { as_guest: true });
      router.replace('/(app)/(tabs)');
    },
    onError: () => haptic.error(),
  });

  const busy = sendCode.isPending || continueAsGuest.isPending;
  const failure = sendCode.error ?? continueAsGuest.error;

  function submit() {
    setTouched(true);
    if (!isValid || busy) return;
    haptic.tap();
    sendCode.mutate();
  }

  return (
    <Screen padded>
      <Animated.View entering={FadeInDown.duration(320)}>
        <Text variant="display" tone="brand" style={styles.wordmark}>
          {t('app.name')}
        </Text>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(320).delay(60)}>
        <Column gap="xs" style={styles.intro}>
          <Text variant="title">{t('auth.phoneTitle')}</Text>
          <Text variant="body" tone="secondary">
            {t('auth.phoneSubtitle')}
          </Text>
        </Column>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(320).delay(120)}>
        <Input
          label={t('auth.phonePlaceholder')}
          prefix={DIAL_CODE}
          value={formatNational(digits)}
          onChangeText={(next) => {
            const cleaned = normaliseDigits(next);
            // One tick of feedback the moment the number becomes complete —
            // not on every keystroke, which would buzz ten times.
            if (cleaned.length === 10 && digits.length !== 10) haptic.selection();
            setDigits(cleaned);
          }}
          onBlur={() => setTouched(true)}
          onSubmitEditing={submit}
          error={showInvalid ? t('auth.phoneInvalid') : undefined}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          returnKeyType="go"
          maxLength={11} // ten digits plus the grouping space
          autoFocus
          editable={!busy}
        />
      </Animated.View>

      {failure !== null && (
        <View style={styles.banner}>
          <Banner message={errorMessage(failure)} detail={traceReference(failure)} />
        </View>
      )}

      <View style={styles.spacer} />

      <KeyboardStickyView offset={{ closed: 0, opened: spacing.md }}>
        <Column gap="md">
          <LegalNotice />
          <Button
            label={t('auth.sendCode')}
            onPress={submit}
            disabled={!isValid}
            loading={sendCode.isPending}
            size="lg"
            fullWidth
            testID="send-code"
          />
          <Button
            label={t('auth.continueAsGuest')}
            onPress={() => {
              haptic.tap();
              continueAsGuest.mutate();
            }}
            variant="ghost"
            loading={continueAsGuest.isPending}
            fullWidth
            testID="continue-as-guest"
          />
        </Column>
      </KeyboardStickyView>
    </Screen>
  );
}

/**
 * "By continuing you agree to our Terms and Privacy Policy."
 *
 * Split from ONE translated sentence rather than assembled from pieces: Hindi
 * puts the verb last, so concatenating fragments produces word salad. The
 * placeholders keep the order wherever the translator puts them.
 */
function LegalNotice() {
  const { t } = useTranslation();
  const parts = t('auth.legalNotice').split(/(\{terms\}|\{privacy\})/);

  return (
    <Text variant="micro" tone="faint" style={styles.legal}>
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

const styles = StyleSheet.create({
  wordmark: { marginTop: spacing.xxl, letterSpacing: -0.5 },
  intro: { marginTop: spacing.sm, marginBottom: spacing.xl },
  banner: { marginTop: spacing.lg },
  spacer: { flex: 1, minHeight: spacing.xl },
  legal: { textAlign: 'center', lineHeight: 16 },
  link: { color: colors.brand.onDark },
});
