import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { queryKeys } from '@/api/queries/keys';
import { ApiErrorCode } from '@/api/types';
import { getDeviceId } from '@/features/auth/device';
import { formatE164ForDisplay } from '@/features/auth/phone';
import { useTranslation } from '@/i18n';
import { errorCode, errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { sessionStore } from '@/store/session';
import { Banner, Button, CodeInput, Column, Row, Screen, Text } from '@/ui';

const CODE_LENGTH = 6;

/**
 * Step two: confirm the code and move the number.
 *
 * Every OTHER device is signed out by the server. That is not a side effect to
 * apologise for — if this change was not the owner's doing, ending the
 * attacker's session is the only thing that still helps them — so the success
 * state says it plainly rather than hiding it.
 */
export default function VerifyPhoneChangeScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ phone?: string }>();
  const phone = params.phone ?? '';

  const [code, setCode] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [done, setDone] = useState(false);

  const confirm = useMutation({
    mutationFn: async (submitted: string) =>
      authApi.confirmPhoneChange({
        phone,
        code: submitted,
        keepDeviceId: await getDeviceId(),
      }),
    onSuccess: (result) => {
      haptic.success();
      // The server already returned the updated user, so there is nothing to
      // re-fetch — patching the store from the response avoids a /me round trip
      // on a screen the user is about to leave.
      sessionStore.signIn(result.user);
      // The other devices this account had are gone now.
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.sessions() });
      setDone(true);
    },
    onError: (error) => {
      haptic.error();
      if (isErrorCode(error, ApiErrorCode.OTP_INVALID)) {
        setErrorKey((n) => n + 1);
        setCode('');
      }
    },
  });

  if (done) {
    return (
      <Screen padded>
        <View style={styles.spacer} />
        <Animated.View entering={FadeIn.duration(220)}>
          <Column gap="md" align="center">
            <Ionicons name="checkmark-circle" size={56} color={colors.status.success} />
            <Text variant="title">{t('account.phoneChanged')}</Text>
            <Text variant="body" tone="secondary" style={styles.doneBody}>
              {t('account.phoneChangedBody', { phone: formatE164ForDisplay(phone) })}
            </Text>
          </Column>
        </Animated.View>
        <View style={styles.spacer} />
        <Button
          label={t('common.done')}
          onPress={() => {
            haptic.tap();
            // Back past the number entry screen — returning to a form for a
            // change that already happened is a dead end.
            router.dismissTo('/(app)/account');
          }}
          size="lg"
          fullWidth
          testID="phone-change-done"
        />
      </Screen>
    );
  }

  const wrongCode = isErrorCode(confirm.error, ApiErrorCode.OTP_INVALID);
  const bannerError = wrongCode ? null : confirm.error;

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
            <Text variant="title">{t('account.phoneVerifyTitle')}</Text>
            <Text variant="body" tone="secondary">
              {t('account.phoneVerifySubtitle', { phone: formatE164ForDisplay(phone) })}
            </Text>
          </Column>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(280).delay(60)}>
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
            accessibilityLabel={t('account.phoneVerifyTitle')}
            autoFocus
          />
        </Animated.View>

        <View style={styles.feedback}>
          {wrongCode && (
            <Animated.View entering={FadeIn.duration(160)}>
              <Text variant="caption" tone="danger">
                {t('auth.otpIncorrect')}
              </Text>
            </Animated.View>
          )}

          {bannerError != null && (
            <Banner
              message={errorMessage(bannerError)}
              detail={traceReference(bannerError)}
              tone={
                errorCode(bannerError) === ApiErrorCode.OTP_ATTEMPTS_EXCEEDED ? 'warning' : 'danger'
              }
            />
          )}
        </View>

        <View style={styles.spacer} />

        <Button
          label={t('account.phoneConfirm')}
          onPress={() => confirm.mutate(code)}
          disabled={code.length !== CODE_LENGTH}
          loading={confirm.isPending}
          size="lg"
          fullWidth
          testID="confirm-phone-change"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  intro: { marginBottom: spacing.xl },
  doneBody: { textAlign: 'center' },
  feedback: { gap: spacing.md, marginTop: spacing.lg },
  spacer: { flex: 1, minHeight: spacing.xl },
});
