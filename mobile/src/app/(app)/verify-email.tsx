import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { ApiErrorCode } from '@/api/types';
import { refreshSessionUser } from '@/features/auth/session';
import { useTranslation } from '@/i18n';
import { errorCode, errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { spacing } from '@/theme';
import { Banner, Button, CodeInput, Column, Screen, Text } from '@/ui';
import { useSession } from '@/store/session';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN = 60;

/**
 * Confirming an email address.
 *
 * Lives in (app) rather than (auth) because registering makes the account
 * ACTIVE, which unmounts the auth stack — the same trap profile-setup hit.
 *
 * Reached right after signing up, and again from the Me screen whenever the
 * user is ready. "I will do this later" is a first-class action, not a hidden
 * one: the account already works, and the only thing confirmation unlocks is
 * money — which most people will not reach for on their first session.
 */
export default function VerifyEmailScreen() {
  const { t } = useTranslation();
  const { user } = useSession();

  const [code, setCode] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const confirm = useMutation({
    mutationFn: (submitted: string) => authApi.confirmEmail(submitted),
    onSuccess: async () => {
      haptic.success();
      // The session's emailVerified is now stale everywhere. Re-reading /me is
      // cheaper and less error-prone than patching the store by hand.
      await refreshSessionUser();
      router.replace('/(app)/(tabs)');
    },
    onError: () => {
      haptic.error();
      setErrorKey((n) => n + 1);
      setCode('');
    },
  });

  const resend = useMutation({
    mutationFn: () => authApi.requestEmailVerification(),
    onSuccess: () => {
      haptic.success();
      setSecondsLeft(RESEND_COOLDOWN);
      setCode('');
      setErrorKey(0);
    },
    onError: () => haptic.error(),
  });

  const wrongCode = isErrorCode(confirm.error, ApiErrorCode.CODE_INVALID);
  const bannerError = wrongCode ? resend.error : (confirm.error ?? resend.error);

  return (
    <Screen padded>
      <Animated.View entering={FadeInDown.duration(300)}>
        <Column gap="xs" style={styles.intro}>
          <Text variant="title">{t('email.verifyTitle')}</Text>
          <Text variant="body" tone="secondary">
            {t('email.verifySubtitle', { email: user?.email ?? '' })}
          </Text>
        </Column>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(300).delay(80)}>
        <CodeInput
          value={code}
          onChange={setCode}
          length={CODE_LENGTH}
          onFilled={(submitted) => {
            haptic.tap();
            confirm.mutate(submitted);
          }}
          errorKey={errorKey}
          disabled={confirm.isPending}
          accessibilityLabel={t('email.verifyTitle')}
          autoFocus
        />
      </Animated.View>

      <View style={styles.feedback}>
        {wrongCode && (
          <Animated.View entering={FadeIn.duration(160)}>
            <Text variant="caption" tone="danger">
              {t('email.codeIncorrect')}
            </Text>
          </Animated.View>
        )}

        {bannerError != null && (
          <Banner
            message={errorMessage(bannerError)}
            detail={traceReference(bannerError)}
            tone={errorCode(bannerError) === ApiErrorCode.EMAIL_RATE_LIMITED ? 'warning' : 'danger'}
          />
        )}
      </View>

      <View style={styles.spacer} />

      <Column gap="md">
        <Button
          label={t('email.verify')}
          onPress={() => confirm.mutate(code)}
          disabled={code.length !== CODE_LENGTH}
          loading={confirm.isPending}
          size="lg"
          fullWidth
          testID="confirm-email"
        />
        <Button
          label={
            secondsLeft > 0 ? t('auth.otpResendIn', { seconds: secondsLeft }) : t('email.resend')
          }
          onPress={() => {
            haptic.tap();
            resend.mutate();
          }}
          disabled={secondsLeft > 0}
          loading={resend.isPending}
          variant="ghost"
          fullWidth
          testID="resend-email-code"
        />
        <Button
          label={t('email.verifyLater')}
          onPress={() => {
            haptic.selection();
            router.replace('/(app)/(tabs)');
          }}
          variant="ghost"
          fullWidth
          testID="verify-later"
        />
      </Column>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: spacing.xxl, marginBottom: spacing.xl },
  feedback: { gap: spacing.md, marginTop: spacing.lg },
  spacer: { flex: 1, minHeight: spacing.xl },
});
