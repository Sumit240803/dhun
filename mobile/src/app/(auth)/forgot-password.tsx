import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { useTranslation } from '@/i18n';
import { errorMessage, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Banner, Button, Column, Input, Row, Screen, Text } from '@/ui';

/** Deliberately permissive. The server is the authority; this only catches typos. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/**
 * Step one of a password reset: ask for the address.
 *
 * The server ANSWERS THE SAME WAY whether or not the address exists, and this
 * screen must not undo that. There is no "no account with that email" state
 * here on purpose — adding one would turn the form into an account-existence
 * oracle, which on an app of this kind can out someone.
 */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);

  const valid = looksLikeEmail(email);

  const send = useMutation({
    mutationFn: () => authApi.forgotPassword(email.trim()),
    onSuccess: () => {
      haptic.success();
      router.push({
        pathname: '/(auth)/reset-password',
        params: { email: email.trim() },
      });
    },
    onError: () => haptic.error(),
  });

  function attempt() {
    setTouched(true);
    if (!valid || send.isPending) return;
    haptic.tap();
    send.mutate();
  }

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
          <Text variant="title">{t('email.forgotTitle')}</Text>
          <Text variant="body" tone="secondary">
            {t('email.forgotSubtitle')}
          </Text>
        </Column>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(300).delay(60)}>
        <Input
          label={t('email.emailLabel')}
          placeholder={t('email.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          onBlur={() => setTouched(true)}
          onSubmitEditing={attempt}
          error={touched && email !== '' && !valid ? t('email.invalidEmail') : undefined}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={254}
          returnKeyType="go"
          editable={!send.isPending}
          autoFocus
        />
      </Animated.View>

      {send.error != null && (
        <View style={styles.banner}>
          <Banner message={errorMessage(send.error)} detail={traceReference(send.error)} />
        </View>
      )}

      <View style={styles.spacer} />

      <KeyboardStickyView offset={{ closed: 0, opened: spacing.md }}>
        <Button
          label={t('email.forgotSend')}
          onPress={attempt}
          disabled={!valid}
          loading={send.isPending}
          size="lg"
          fullWidth
          testID="send-reset-code"
        />
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
