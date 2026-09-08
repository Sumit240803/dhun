import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { ApiErrorCode } from '@/api/types';
import {
  DIAL_CODE,
  formatE164ForDisplay,
  formatNational,
  isValidNational,
  normaliseDigits,
  toE164,
} from '@/features/auth/phone';
import { useTranslation } from '@/i18n';
import { errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { useSession } from '@/store/session';
import { Banner, Button, Column, Input, Row, Screen, Text } from '@/ui';

/**
 * Step one of moving an account to a different number.
 *
 * The code goes to the NEW number, not the old one. That is deliberate and it
 * is the whole reason this screen can exist: the commonest reason to change is
 * that the old SIM is gone, and a flow that requires the thing you lost is a
 * flow nobody can finish. The password re-proves the account instead.
 */
export default function ChangePhoneScreen() {
  const { t } = useTranslation();
  const { user } = useSession();

  const [digits, setDigits] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  // A phone-only account has no password to ask for. Asking anyway would be a
  // field nobody can fill.
  const needsPassword = user?.email != null;
  const numberValid = isValidNational(digits);
  const ready = numberValid && (!needsPassword || password.length > 0);

  const send = useMutation({
    mutationFn: () =>
      authApi.requestPhoneChange({
        phone: toE164(digits),
        channel: 'whatsapp',
        ...(needsPassword ? { password } : {}),
      }),
    onSuccess: () => {
      haptic.success();
      router.push({
        pathname: '/(app)/account/phone-verify',
        params: { phone: toE164(digits) },
      });
    },
    onError: () => haptic.error(),
  });

  function attempt() {
    setTouched(true);
    if (!ready || send.isPending) return;
    haptic.tap();
    send.mutate();
  }

  const wrongPassword =
    isErrorCode(send.error, ApiErrorCode.INVALID_CREDENTIALS) ||
    isErrorCode(send.error, ApiErrorCode.PASSWORD_REQUIRED);

  // Both belong under the number field — they are corrections to what was just
  // typed, not news about the system.
  const numberError = isErrorCode(send.error, ApiErrorCode.PHONE_TAKEN)
    ? t('account.phoneTaken')
    : isErrorCode(send.error, ApiErrorCode.PHONE_UNCHANGED)
      ? t('account.phoneUnchanged')
      : touched && digits.length === 10 && !numberValid
        ? t('account.phoneInvalid')
        : undefined;

  const bannerError = wrongPassword || numberError !== undefined ? null : send.error;

  return (
    <Screen padded={false} edges={['top']}>
      <Row style={styles.header} gap="md">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={spacing.md}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
        </Pressable>
        <Text variant="heading">{t('account.phone')}</Text>
      </Row>

      <View style={styles.body}>
        <Animated.View entering={FadeInDown.duration(280)}>
          <Column gap="xs" style={styles.intro}>
            <Text variant="title">{t('account.phoneTitle')}</Text>
            <Text variant="body" tone="secondary">
              {t('account.phoneIntro')}
            </Text>
            {user?.phone != null && (
              <Text variant="caption" tone="faint">
                {t('account.phoneCurrent', { phone: formatE164ForDisplay(user.phone) })}
              </Text>
            )}
          </Column>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(280).delay(60)}>
          <Column gap="lg">
            <Input
              label={t('account.phoneNew')}
              prefix={DIAL_CODE}
              value={formatNational(digits)}
              onChangeText={(value) => {
                setDigits(normaliseDigits(value));
                if (send.error) send.reset();
              }}
              onBlur={() => setTouched(true)}
              error={numberError}
              keyboardType="number-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              maxLength={11}
              editable={!send.isPending}
              autoFocus
            />

            {needsPassword && (
              <Input
                label={t('account.phonePassword')}
                helper={t('account.phonePasswordHint')}
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  if (send.error) send.reset();
                }}
                onSubmitEditing={attempt}
                error={wrongPassword ? t('account.wrongCurrent') : undefined}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                autoCapitalize="none"
                maxLength={200}
                returnKeyType="go"
                editable={!send.isPending}
              />
            )}
          </Column>
        </Animated.View>

        {bannerError != null && (
          <View style={styles.banner}>
            <Banner message={errorMessage(bannerError)} detail={traceReference(bannerError)} />
          </View>
        )}

        <View style={styles.spacer} />

        <KeyboardStickyView offset={{ closed: 0, opened: spacing.md }}>
          <Button
            label={t('account.phoneSend')}
            onPress={attempt}
            disabled={!ready}
            loading={send.isPending}
            size="lg"
            fullWidth
            testID="send-phone-change-code"
          />
        </KeyboardStickyView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  intro: { marginBottom: spacing.xl },
  banner: { marginTop: spacing.lg },
  spacer: { flex: 1, minHeight: spacing.xl },
});
