import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { ApiErrorCode } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorCode, errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Banner, Button, CodeInput, Column, Input, Row, Screen, Text } from '@/ui';

const CODE_LENGTH = 6;
const MIN_PASSWORD = 8;

/**
 * Step two of a password reset: the code and the new password, on one screen.
 *
 * Deliberately not split across two. Someone holding a code that expires in
 * fifteen minutes should not have to pass a screen boundary to use it, and the
 * server checks both in a single call anyway.
 *
 * Success does NOT sign the user in. The reset revokes every refresh token —
 * that is the point, since a compromised account would otherwise leave the
 * attacker signed in — so there is nothing to adopt and the only honest next
 * step is signing in with the new password.
 */
export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = params.email ?? '';

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [touched, setTouched] = useState(false);
  const [errorKey, setErrorKey] = useState(0);
  const [done, setDone] = useState(false);

  const passwordValid = password.length >= MIN_PASSWORD;
  const codeValid = code.length === CODE_LENGTH;

  const reset = useMutation({
    mutationFn: () => authApi.resetPassword({ email, code, password }),
    onSuccess: () => {
      haptic.success();
      setDone(true);
    },
    onError: (error) => {
      haptic.error();
      // Only the CODE gets cleared, never the password — a wrong code should
      // not cost someone the passphrase they just typed.
      if (
        isErrorCode(error, ApiErrorCode.CODE_INVALID) ||
        isErrorCode(error, ApiErrorCode.CODE_NOT_FOUND)
      ) {
        setErrorKey((n) => n + 1);
        setCode('');
      }
    },
  });

  function attempt() {
    setTouched(true);
    if (!codeValid || !passwordValid || reset.isPending) return;
    haptic.tap();
    reset.mutate();
  }

  if (done) {
    return (
      <Screen padded>
        <View style={styles.spacer} />
        <Animated.View entering={FadeIn.duration(220)}>
          <Column gap="md" align="center">
            <Ionicons name="checkmark-circle" size={56} color={colors.status.success} />
            <Text variant="title">{t('email.resetDone')}</Text>
          </Column>
        </Animated.View>
        <View style={styles.spacer} />
        <Button
          label={t('email.signIn')}
          onPress={() => {
            haptic.tap();
            router.dismissTo('/(auth)/email');
          }}
          size="lg"
          fullWidth
          testID="reset-done-sign-in"
        />
      </Screen>
    );
  }

  const wrongCode = isErrorCode(reset.error, ApiErrorCode.CODE_INVALID);
  const shortPassword = isErrorCode(reset.error, ApiErrorCode.PASSWORD_TOO_SHORT);

  return (
    <Screen padded scroll>
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
          <Text variant="title">{t('email.resetTitle')}</Text>
          <Text variant="body" tone="secondary">
            {t('email.resetSubtitle', { email })}
          </Text>
        </Column>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(300).delay(60)}>
        <CodeInput
          value={code}
          onChange={setCode}
          length={CODE_LENGTH}
          errorKey={errorKey}
          disabled={reset.isPending}
          accessibilityLabel={t('email.resetTitle')}
          autoFocus
        />
      </Animated.View>

      {wrongCode && (
        <Animated.View entering={FadeIn.duration(160)} style={styles.codeError}>
          <Text variant="caption" tone="danger">
            {t('email.codeIncorrect')}
          </Text>
        </Animated.View>
      )}

      <Animated.View entering={FadeInDown.duration(300).delay(120)} style={styles.password}>
        <Input
          label={t('email.resetPasswordLabel')}
          value={password}
          onChangeText={setPassword}
          onBlur={() => setTouched(true)}
          onSubmitEditing={attempt}
          helper={t('email.passwordHint')}
          error={
            (touched && password !== '' && !passwordValid) || shortPassword
              ? t('email.passwordTooShort')
              : undefined
          }
          secureTextEntry={!reveal}
          textContentType="newPassword"
          autoComplete="new-password"
          autoCapitalize="none"
          maxLength={200}
          returnKeyType="go"
          editable={!reset.isPending}
          right={
            <Pressable
              onPress={() => setReveal((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={t('email.resetPasswordLabel')}
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
      </Animated.View>

      {reset.error != null && !wrongCode && !shortPassword && (
        <View style={styles.banner}>
          <Banner
            message={errorMessage(reset.error)}
            detail={traceReference(reset.error)}
            tone={
              errorCode(reset.error) === ApiErrorCode.CODE_ATTEMPTS_EXCEEDED ? 'warning' : 'danger'
            }
          />
        </View>
      )}

      <View style={styles.spacer} />

      <KeyboardStickyView offset={{ closed: 0, opened: spacing.md }}>
        <Button
          label={t('email.reset')}
          onPress={attempt}
          disabled={!codeValid || !passwordValid}
          loading={reset.isPending}
          size="lg"
          fullWidth
          testID="submit-reset"
        />
      </KeyboardStickyView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { height: 44, marginLeft: -spacing.xs },
  intro: { marginTop: spacing.lg, marginBottom: spacing.xl },
  codeError: { marginTop: spacing.md },
  password: { marginTop: spacing.xl },
  banner: { marginTop: spacing.lg },
  spacer: { flex: 1, minHeight: spacing.xl },
});
