import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { ApiErrorCode } from '@/api/types';
import { getDevicePayload } from '@/features/auth/device';
import { adoptSession } from '@/features/auth/session';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Banner, Button, Column, Input, Row, Screen, Text } from '@/ui';

const MIN_PASSWORD = 8;

/** Deliberately permissive. The server is the authority; this only catches typos. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export default function EmailAuthScreen() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [reveal, setReveal] = useState(false);

  const emailValid = looksLikeEmail(email);
  const passwordValid = password.length >= MIN_PASSWORD;

  const submit = useMutation({
    mutationFn: async () => {
      const device = await getDevicePayload();
      return mode === 'signUp'
        ? authApi.registerWithEmail({ email: email.trim(), password, device })
        : authApi.loginWithEmail({ email: email.trim(), password, device });
    },
    onSuccess: async (session) => {
      haptic.success();
      track(mode === 'signUp' ? 'signup_completed' : 'login_completed', { method: 'email' });
      await adoptSession(session);

      // Confirmation is DEFERRABLE: a new account goes straight into the app
      // and is offered the verify step on the way, never blocked by it.
      //
      // The verify screen lives in (app), not (auth) — registering makes the
      // account ACTIVE, which unmounts the auth stack. Routing there would
      // navigate to a screen that no longer exists.
      if (!session.user.profileComplete) {
        router.replace('/(app)/profile-setup');
      } else if (mode === 'signUp') {
        router.replace('/(app)/verify-email');
      } else {
        router.replace('/(app)/(tabs)');
      }
    },
    onError: () => haptic.error(),
  });

  function attempt() {
    setTouched(true);
    if (!emailValid || !passwordValid || submit.isPending) return;
    haptic.tap();
    submit.mutate();
  }

  // Wrong credentials belong under the form, not in a banner — it is a
  // correction to what was just typed, not news about the system.
  const credentialsError =
    isErrorCode(submit.error, ApiErrorCode.INVALID_CREDENTIALS) ||
    isErrorCode(submit.error, ApiErrorCode.EMAIL_TAKEN);

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
          <Text variant="title">
            {mode === 'signUp' ? t('email.signUpTitle') : t('email.signInTitle')}
          </Text>
          <Text variant="body" tone="secondary">
            {mode === 'signUp' ? t('email.signUpSubtitle') : t('email.signInSubtitle')}
          </Text>
        </Column>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(300).delay(60)}>
        <Column gap="lg">
          <Input
            label={t('email.emailLabel')}
            placeholder={t('email.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            onBlur={() => setTouched(true)}
            error={touched && email !== '' && !emailValid ? t('email.invalidEmail') : undefined}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
            editable={!submit.isPending}
          />

          <Input
            label={t('email.passwordLabel')}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={attempt}
            helper={mode === 'signUp' ? t('email.passwordHint') : undefined}
            error={
              touched && password !== '' && !passwordValid
                ? t('email.passwordTooShort')
                : credentialsError
                  ? errorMessage(submit.error)
                  : undefined
            }
            secureTextEntry={!reveal}
            // newPassword tells the keychain to OFFER to save it; password tells
            // it to fill an existing one. Getting this backwards is why some
            // apps never autofill.
            textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            autoCapitalize="none"
            maxLength={200}
            returnKeyType="go"
            editable={!submit.isPending}
            right={
              <Pressable
                onPress={() => setReveal((current) => !current)}
                accessibilityRole="button"
                accessibilityLabel={t('email.passwordLabel')}
                hitSlop={spacing.sm}
              >
                <Ionicons
                  name={reveal ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.text.faint}
                />
              </Pressable>
            }
          />
        </Column>
      </Animated.View>

      {submit.error != null && !credentialsError && (
        <View style={styles.banner}>
          <Banner message={errorMessage(submit.error)} detail={traceReference(submit.error)} />
        </View>
      )}

      <View style={styles.spacer} />

      <KeyboardStickyView offset={{ closed: 0, opened: spacing.md }}>
        <Column gap="md">
          <Button
            label={mode === 'signUp' ? t('email.signUp') : t('email.signIn')}
            onPress={attempt}
            disabled={!emailValid || !passwordValid}
            loading={submit.isPending}
            size="lg"
            fullWidth
            testID="email-submit"
          />
          <Button
            label={mode === 'signUp' ? t('email.switchToSignIn') : t('email.switchToSignUp')}
            onPress={() => {
              haptic.selection();
              setMode((current) => (current === 'signUp' ? 'signIn' : 'signUp'));
              submit.reset();
            }}
            variant="ghost"
            fullWidth
            testID="email-switch-mode"
          />
        </Column>
      </KeyboardStickyView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { height: 44, marginLeft: -spacing.xs },
  intro: { marginTop: spacing.lg, marginBottom: spacing.xl },
  banner: { marginTop: spacing.lg },
  spacer: { flex: 1, minHeight: spacing.xl },
});
