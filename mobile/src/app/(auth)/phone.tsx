import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { getDevicePayload } from '@/features/auth/device';
import { adoptSession } from '@/features/auth/session';
import { isWidgetAvailable, sendWidgetOtp } from '@/features/auth/otpWidget';
import { useAppConfig } from '@/features/config/useAppConfig';
import {
  DIAL_CODE,
  formatNational,
  isValidNational,
  normaliseDigits,
  toE164,
} from '@/features/auth/phone';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorMessage, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Banner, Button, Column, Input, Row, Screen, Text } from '@/ui';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const { otpWidget } = useAppConfig();
  const [digits, setDigits] = useState('');
  const [touched, setTouched] = useState(false);

  const isValid = isValidNational(digits);
  // Only complain once they have typed enough to have made a mistake. Showing
  // "enter a valid number" against an empty field is scolding someone for not
  // having started yet.
  const showInvalid = touched && digits.length === 10 && !isValid;

  /**
   * Two delivery paths, one screen.
   *
   * MSG91's widget when the server says it is configured and the native module
   * is actually in this build; our own OTP flow otherwise. The OTP path is not
   * dead code kept for tidiness — it is the fallback that turns an MSG91
   * outage into a degraded signup rather than no signup at all.
   *
   * Which one ran is carried into the next screen, because the code is checked
   * in different places: MSG91 checks the widget's, our server checks ours.
   */
  const sendCode = useMutation({
    mutationFn: async () => {
      const phone = toE164(digits);

      if (isWidgetAvailable(otpWidget)) {
        const sent = await sendWidgetOtp(otpWidget!, phone);

        // MSG91 can verify without a code — invisible verification, or a
        // number it has seen before. No SMS is coming, so the code screen
        // would be a dead end. Sign in directly instead.
        if (sent.kind === 'verified') {
          const session = await authApi.verifyWidgetToken({
            accessToken: sent.accessToken,
            device: await getDevicePayload(),
          });
          return { via: 'verified' as const, phone, session };
        }

        return { via: 'widget' as const, phone, reqId: sent.reqId };
      }

      const result = await authApi.requestOtp(phone);
      return { via: 'server' as const, phone, result };
    },
    onSuccess: async (sent) => {
      haptic.success();

      if (sent.via === 'verified') {
        track('otp_verified', { channel: 'widget_invisible' });
        await adoptSession(sent.session);
        router.replace(
          sent.session.user.profileComplete ? '/(app)/(tabs)' : '/(app)/profile-setup',
        );
        return;
      }

      track('otp_sent', {
        channel: sent.via === 'widget' ? 'widget' : sent.result.channel,
      });

      router.push({
        pathname: '/(auth)/otp',
        params: {
          phone: sent.phone,
          via: sent.via,
          ...(sent.via === 'widget'
            ? { reqId: sent.reqId }
            : {
                expiresIn: String(sent.result.expiresInSeconds),
                // Development only — the backend omits it in production, and it
                // is what makes the flow testable before DLT clears.
                ...(sent.result.devCode ? { devCode: sent.result.devCode } : {}),
              }),
        },
      });
    },
    onError: () => haptic.error(),
  });

  const busy = sendCode.isPending;
  const failure = sendCode.error;

  function submit() {
    setTouched(true);
    if (!isValid || busy) return;
    haptic.tap();
    sendCode.mutate();
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

      <Animated.View entering={FadeInDown.duration(320)}>
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
        <Button
          label={t('auth.sendCode')}
          onPress={submit}
          disabled={!isValid}
          loading={sendCode.isPending}
          size="lg"
          fullWidth
          testID="send-code"
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
