import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { ApiErrorCode } from '@/api/types';
import { getDevicePayload } from '@/features/auth/device';
import { formatE164ForDisplay } from '@/features/auth/phone';
import { adoptSession } from '@/features/auth/session';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorCode, errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Banner, Button, CodeInput, Column, Row, Screen, Text } from '@/ui';

const CODE_LENGTH = 6;
/** Seconds before "Resend" becomes tappable. The server caps sends per phone anyway. */
const RESEND_COOLDOWN = 30;

export default function OtpScreen() {
  const { t, tPlural } = useTranslation();
  const params = useLocalSearchParams<{ phone: string; devCode?: string }>();
  const phone = params.phone ?? '';

  const [code, setCode] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN);
  const [devCode, setDevCode] = useState(params.devCode);

  // Guards the auto-submit: onFilled fires on the change that completes the
  // code, and would fire again if the user edited and refilled it while the
  // first request was still in flight.
  const submitting = useRef(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const verify = useMutation({
    mutationFn: async (submitted: string) => {
      submitting.current = true;
      return authApi.verifyOtp({ phone, code: submitted, device: await getDevicePayload() });
    },
    onSuccess: async (session) => {
      haptic.success();
      track('otp_verified', {});
      await adoptSession(session);

      // A returning user goes straight in; only someone whose profile is
      // unfinished sees that step. `profileComplete` comes from the server
      // because the client never sees the date of birth and so cannot work it
      // out — checking `displayName` alone would let a half-finished account
      // through with no date on file.
      if (session.user.profileComplete) {
        track('login_completed', {});
        router.replace('/(app)/(tabs)');
      } else {
        router.replace('/(app)/profile-setup');
      }
    },
    onError: (error) => {
      haptic.error();
      setErrorKey((n) => n + 1);
      setCode('');

      const remaining = (error as { details?: { attemptsRemaining?: number } })?.details
        ?.attemptsRemaining;
      setAttemptsLeft(
        isErrorCode(error, ApiErrorCode.OTP_INVALID) && typeof remaining === 'number'
          ? remaining
          : null,
      );
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  const resend = useMutation({
    mutationFn: () => authApi.requestOtp(phone),
    onSuccess: (result) => {
      haptic.success();
      track('otp_sent', { channel: result.channel, resend: true });
      setSecondsLeft(RESEND_COOLDOWN);
      setCode('');
      setAttemptsLeft(null);
      setErrorKey(0);
      setDevCode(result.devCode);
    },
    onError: () => haptic.error(),
  });

  function submit(submitted: string) {
    if (submitting.current || verify.isPending) return;
    haptic.tap();
    verify.mutate(submitted);
  }

  // A wrong code is shown against the boxes with the attempts left. Everything
  // else — expired, locked out, offline — is a banner, because the answer is
  // "request a new code", not "try again in this field".
  const showInline = isErrorCode(verify.error, ApiErrorCode.OTP_INVALID);
  const bannerError = showInline ? resend.error : (verify.error ?? resend.error);

  return (
    <Screen padded>
      <Row style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={spacing.md}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
        </Pressable>
      </Row>

      <Animated.View entering={FadeInDown.duration(300)}>
        <Column gap="xs" style={styles.intro}>
          <Text variant="title">{t('auth.otpTitle')}</Text>
          <Row gap="xs" wrap>
            <Text variant="body" tone="secondary">
              {t('auth.otpSubtitle', { phone: formatE164ForDisplay(phone) })}
            </Text>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              hitSlop={spacing.sm}
            >
              <Text variant="bodyStrong" tone="brand">
                {t('common.change')}
              </Text>
            </Pressable>
          </Row>
        </Column>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(300).delay(80)}>
        <CodeInput
          value={code}
          onChange={setCode}
          length={CODE_LENGTH}
          onFilled={submit}
          errorKey={errorKey}
          disabled={verify.isPending}
          accessibilityLabel={t('auth.otpTitle')}
          autoFocus
        />
      </Animated.View>

      <View style={styles.feedback}>
        {showInline && (
          <Animated.View entering={FadeIn.duration(160)}>
            <Column gap="xs">
              <Text variant="caption" tone="danger">
                {t('auth.otpIncorrect')}
              </Text>
              {attemptsLeft !== null && attemptsLeft > 0 && (
                <Text variant="caption" tone="faint">
                  {tPlural('auth.otpAttemptsLeft', 'auth.otpAttemptsLeftPlural', attemptsLeft)}
                </Text>
              )}
            </Column>
          </Animated.View>
        )}

        {bannerError != null && (
          <Banner
            message={errorMessage(bannerError)}
            detail={traceReference(bannerError)}
            tone={errorCode(bannerError) === ApiErrorCode.OTP_RATE_LIMITED ? 'warning' : 'danger'}
          />
        )}

        {devCode !== undefined && (
          <Banner tone="info" message={t('auth.devCode', { code: devCode })} />
        )}
      </View>

      <View style={styles.spacer} />

      <Column gap="md">
        <Button
          label={t('common.continue')}
          onPress={() => submit(code)}
          disabled={code.length !== CODE_LENGTH}
          loading={verify.isPending}
          size="lg"
          fullWidth
          testID="verify-code"
        />
        <Button
          label={
            secondsLeft > 0 ? t('auth.otpResendIn', { seconds: secondsLeft }) : t('auth.otpResend')
          }
          onPress={() => {
            haptic.tap();
            resend.mutate();
          }}
          disabled={secondsLeft > 0}
          loading={resend.isPending}
          variant="ghost"
          fullWidth
          testID="resend-code"
        />
      </Column>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { height: 44, marginLeft: -spacing.xs },
  intro: { marginTop: spacing.lg, marginBottom: spacing.xl },
  feedback: { gap: spacing.md, marginTop: spacing.lg },
  spacer: { flex: 1, minHeight: spacing.xl },
});
