import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { ApiErrorCode } from '@/api/types';
import { getDeviceId } from '@/features/auth/device';
import { useTranslation } from '@/i18n';
import { errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Banner, Button, Column, Input, Row, Screen, Text } from '@/ui';

const MIN_PASSWORD = 8;

/**
 * Changing a password from inside the app.
 *
 * The CURRENT password is required even though the caller is already signed in:
 * a borrowed unlocked phone must not be able to lock the owner out of their own
 * account. The server enforces it; this screen just asks for it plainly.
 *
 * Every OTHER device is signed out. That is the actual point of the action for
 * anyone doing it because they think someone else got in — and this device is
 * deliberately kept, because signing you out of the phone in your hand reads as
 * a failure rather than as security.
 */
export default function ChangePasswordScreen() {
  const { t } = useTranslation();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [reveal, setReveal] = useState(false);
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(false);

  const nextValid = next.length >= MIN_PASSWORD;
  const ready = current.length > 0 && nextValid;

  const change = useMutation({
    mutationFn: async () =>
      authApi.changePassword({
        currentPassword: current,
        newPassword: next,
        keepDeviceId: await getDeviceId(),
      }),
    onSuccess: () => {
      haptic.success();
      setDone(true);
      setCurrent('');
      setNext('');
    },
    onError: () => haptic.error(),
  });

  function attempt() {
    setTouched(true);
    if (!ready || change.isPending) return;
    haptic.tap();
    change.mutate();
  }

  // The wrong current password is a correction to what was just typed, so it
  // belongs under that field — not in a banner, which reads as system news.
  const wrongCurrent = isErrorCode(change.error, ApiErrorCode.INVALID_CREDENTIALS);
  const shortNew = isErrorCode(change.error, ApiErrorCode.PASSWORD_TOO_SHORT);
  const bannerError = wrongCurrent || shortNew ? null : change.error;

  if (done) {
    return (
      <Screen padded>
        <View style={styles.spacer} />
        <Animated.View entering={FadeIn.duration(220)}>
          <Column gap="md" align="center">
            <Ionicons name="checkmark-circle" size={56} color={colors.status.success} />
            <Text variant="title">{t('account.changed')}</Text>
            <Text variant="body" tone="secondary" style={styles.doneBody}>
              {t('account.changeSubtitle')}
            </Text>
          </Column>
        </Animated.View>
        <View style={styles.spacer} />
        <Button
          label={t('common.done')}
          onPress={() => {
            haptic.tap();
            router.back();
          }}
          size="lg"
          fullWidth
          testID="password-change-done"
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false} edges={['top']} scroll={false}>
      <Row style={styles.header} gap="md">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={spacing.md}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
        </Pressable>
        <Text variant="heading">{t('account.password')}</Text>
      </Row>

      <View style={styles.body}>
        <Animated.View entering={FadeInDown.duration(280)}>
          <Column gap="xs" style={styles.intro}>
            <Text variant="title">{t('account.changeTitle')}</Text>
            <Text variant="body" tone="secondary">
              {t('account.changeSubtitle')}
            </Text>
          </Column>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(280).delay(60)}>
          <Column gap="lg">
            <Input
              label={t('account.currentPassword')}
              value={current}
              onChangeText={(value) => {
                setCurrent(value);
                if (change.error) change.reset();
              }}
              error={wrongCurrent ? t('account.wrongCurrent') : undefined}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              autoCapitalize="none"
              maxLength={200}
              editable={!change.isPending}
            />

            <Input
              label={t('account.newPassword')}
              value={next}
              onChangeText={setNext}
              onBlur={() => setTouched(true)}
              onSubmitEditing={attempt}
              helper={t('email.passwordHint')}
              error={
                (touched && next !== '' && !nextValid) || shortNew
                  ? t('email.passwordTooShort')
                  : undefined
              }
              secureTextEntry={!reveal}
              textContentType="newPassword"
              autoComplete="new-password"
              autoCapitalize="none"
              maxLength={200}
              returnKeyType="go"
              editable={!change.isPending}
              right={
                <Pressable
                  onPress={() => setReveal((value) => !value)}
                  accessibilityRole="button"
                  accessibilityLabel={t('account.newPassword')}
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

        {bannerError != null && (
          <View style={styles.feedback}>
            <Banner message={errorMessage(bannerError)} detail={traceReference(bannerError)} />
          </View>
        )}

        <View style={styles.spacer} />

        <KeyboardStickyView offset={{ closed: 0, opened: spacing.md }}>
          <Button
            label={t('account.change')}
            onPress={attempt}
            disabled={!ready}
            loading={change.isPending}
            size="lg"
            fullWidth
            testID="submit-password-change"
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
  doneBody: { textAlign: 'center' },
  feedback: { marginTop: spacing.lg },
  spacer: { flex: 1, minHeight: spacing.xl },
});
