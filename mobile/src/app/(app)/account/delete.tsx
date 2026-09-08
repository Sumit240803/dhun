import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { ApiErrorCode } from '@/api/types';
import { signOut } from '@/features/auth/session';
import { useTranslation } from '@/i18n';
import { errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { useSession } from '@/store/session';
import {
  Banner,
  Button,
  Card,
  Column,
  Input,
  Row,
  Screen,
  Sheet,
  Text,
  type SheetHandle,
} from '@/ui';

/**
 * Deleting an account.
 *
 * Required by Google Play for any app with accounts, and by DPDP Act 2023 —
 * not an optional courtesy, and not something to bury behind a support email.
 *
 * Two deliberate gates before the request goes out: typing the confirmation
 * word, and the account password. Neither is friction for its own sake — a
 * borrowed unlocked phone must not be able to do this, and a mis-tap on a
 * destructive row must not either.
 *
 * What the server actually does is ANONYMISE: the ledger is append-only and its
 * entries point at this user, so the row survives with every identifying field
 * cleared. The copy says what the user cares about — their profile, messages
 * and balance are gone — without promising a row deletion that cannot happen.
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const confirmSheet = useRef<SheetHandle>(null);

  const [word, setWord] = useState('');
  const [password, setPassword] = useState('');

  const confirmWord = t('account.deleteConfirmWord');
  const hasPassword = user?.email != null;
  const wordMatches = word.trim().toUpperCase() === confirmWord;
  const ready = wordMatches && (!hasPassword || password.length > 0);

  const remove = useMutation({
    mutationFn: () => authApi.deleteAccount(hasPassword ? password : undefined),
    onSuccess: async () => {
      haptic.success();
      confirmSheet.current?.dismiss();
      // Local state must go too. The tokens are already dead server-side, but
      // leaving the cache in place would flash a deleted user's balance and
      // messages at whoever opens the app next.
      await signOut();
      queryClient.clear();
      router.replace('/(auth)');
    },
    onError: () => haptic.error(),
  });

  const wrongPassword =
    isErrorCode(remove.error, ApiErrorCode.INVALID_CREDENTIALS) ||
    isErrorCode(remove.error, ApiErrorCode.PASSWORD_REQUIRED);

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
        <Text variant="heading">{t('account.deleteRow')}</Text>
      </Row>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(280)}>
          <Column gap="md">
            <View style={styles.mark}>
              <Ionicons name="warning" size={22} color={colors.status.danger} />
            </View>
            <Text variant="title">{t('account.deleteTitle')}</Text>
            <Text variant="body" tone="secondary">
              {t('account.deleteBody')}
            </Text>
            <Text variant="bodyStrong" tone="danger">
              {t('account.deleteFinal')}
            </Text>
          </Column>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(280).delay(60)}>
          <Card>
            <Column gap="lg">
              <Input
                label={t('account.deleteConfirmLabel', { word: confirmWord })}
                value={word}
                onChangeText={setWord}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={16}
                editable={!remove.isPending}
                testID="delete-confirm-word"
              />

              {hasPassword && (
                <Input
                  label={t('account.deletePassword')}
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    if (remove.error) remove.reset();
                  }}
                  error={wrongPassword ? t('account.wrongCurrent') : undefined}
                  secureTextEntry
                  textContentType="password"
                  autoComplete="current-password"
                  autoCapitalize="none"
                  maxLength={200}
                  editable={!remove.isPending}
                  testID="delete-password"
                />
              )}
            </Column>
          </Card>
        </Animated.View>

        {remove.error != null && !wrongPassword && (
          <Banner message={errorMessage(remove.error)} detail={traceReference(remove.error)} />
        )}

        <Button
          label={t('account.deleteConfirm')}
          onPress={() => {
            haptic.tap();
            confirmSheet.current?.present();
          }}
          disabled={!ready}
          variant="danger"
          size="lg"
          fullWidth
          testID="delete-account"
        />
      </ScrollView>

      {/* One last stop. The form gathers the proof; the sheet asks the question. */}
      <Sheet ref={confirmSheet} title={t('account.deleteTitle')}>
        <Text variant="body" tone="secondary">
          {t('account.deleteFinal')}
        </Text>
        <Column gap="sm">
          <Button
            label={t('account.deleteConfirm')}
            onPress={() => remove.mutate()}
            loading={remove.isPending}
            variant="danger"
            fullWidth
            testID="delete-account-confirm"
          />
          <Button
            label={t('common.cancel')}
            onPress={() => confirmSheet.current?.dismiss()}
            variant="ghost"
            fullWidth
          />
        </Column>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  mark: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.status.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
