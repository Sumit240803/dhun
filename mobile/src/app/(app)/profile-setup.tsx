import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { ApiErrorCode } from '@/api/types';
import {
  MIN_AGE,
  ageInYears,
  earliestDob,
  formatDob,
  latestAdultDob,
  toApiDate,
} from '@/features/auth/dob';
import { useTranslation, type MessageKey } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorMessage, fieldError, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { sessionStore } from '@/store/session';
import { Banner, Button, Chip, Column, Input, Row, Screen, Text } from '@/ui';

type Gender = 'male' | 'female' | 'other' | 'undisclosed';

const GENDERS: { value: Gender; label: MessageKey }[] = [
  { value: 'male', label: 'auth.genderMale' },
  { value: 'female', label: 'auth.genderFemale' },
  { value: 'other', label: 'auth.genderOther' },
  { value: 'undisclosed', label: 'auth.genderUndisclosed' },
];

export default function ProfileSetupScreen() {
  const { t, locale } = useTranslation();

  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [dob, setDob] = useState<Date | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const nameIsValid = name.trim().length >= 2;
  const dobIsValid = dob !== null && ageInYears(dob) >= MIN_AGE;

  const save = useMutation({
    mutationFn: () =>
      authApi.updateProfile({
        displayName: name.trim(),
        dateOfBirth: toApiDate(dob!),
        ...(gender !== null ? { gender } : {}),
      }),
    onSuccess: ({ user }) => {
      haptic.success();
      track('signup_completed', { has_gender: gender !== null });
      // The session store is what the router guard reads, so updating it here
      // is what makes the next render see a named, registered user.
      sessionStore.signIn(user);
      router.replace('/(app)/(tabs)');
    },
    onError: () => haptic.error(),
  });

  function handlePicked(event: DateTimePickerEvent, picked?: Date) {
    // Android renders its own dialog and reports 'dismissed' on cancel; iOS
    // keeps the inline picker mounted until this screen hides it.
    if (Platform.OS === 'android') setPickerOpen(false);
    if (event.type === 'dismissed' || picked === undefined) return;
    haptic.selection();
    setDob(picked);
  }

  function submit() {
    setNameTouched(true);
    if (!nameIsValid || !dobIsValid || save.isPending) return;
    haptic.tap();
    save.mutate();
  }

  // The server is the authority on age, but it should never be the first to
  // say no: the picker's maximumDate makes an underage date unpickable, and
  // this only fires if that is somehow bypassed.
  const dobError = isErrorCode(save.error, ApiErrorCode.UNDERAGE)
    ? t('auth.mustBeAdult')
    : fieldError(save.error, 'dateOfBirth');

  const showBanner =
    save.error != null && dobError === undefined && !isErrorCode(save.error, ApiErrorCode.UNDERAGE);

  return (
    <Screen padded scroll>
      <Animated.View entering={FadeInDown.duration(300)}>
        <Column gap="xs" style={styles.intro}>
          <Text variant="title">{t('auth.profileTitle')}</Text>
          <Text variant="body" tone="secondary">
            {t('auth.profileSubtitle')}
          </Text>
        </Column>
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(300).delay(60)}>
        <Input
          label={t('auth.displayName')}
          placeholder={t('auth.displayNamePlaceholder')}
          value={name}
          onChangeText={setName}
          onBlur={() => setNameTouched(true)}
          error={
            nameTouched && !nameIsValid
              ? t('auth.displayNameTooShort')
              : fieldError(save.error, 'displayName')
          }
          autoCapitalize="words"
          autoComplete="name"
          maxLength={32}
          returnKeyType="next"
          editable={!save.isPending}
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(300).delay(120)} style={styles.section}>
        <Column gap="xs">
          <Text variant="caption" tone="secondary">
            {t('auth.dateOfBirth')}
          </Text>

          <Pressable
            onPress={() => {
              haptic.tap();
              setPickerOpen((open) => !open);
            }}
            disabled={save.isPending}
            accessibilityRole="button"
            accessibilityLabel={t('auth.dobSelect')}
            accessibilityValue={{ text: dob === null ? undefined : formatDob(dob, locale) }}
            style={({ pressed }) => [
              styles.dobField,
              dobError !== undefined && styles.dobFieldError,
              pressed && styles.dobFieldPressed,
            ]}
            testID="dob-field"
          >
            <Text variant="body" tone={dob === null ? 'faint' : 'primary'}>
              {dob === null ? t('auth.dobSelect') : formatDob(dob, locale)}
            </Text>
            <Ionicons name="calendar-outline" size={20} color={colors.text.faint} />
          </Pressable>

          <Text variant="caption" tone={dobError !== undefined ? 'danger' : 'faint'}>
            {dobError ?? t('auth.dobHelp')}
          </Text>
        </Column>

        {pickerOpen && (
          <Animated.View entering={FadeIn.duration(160)} style={styles.picker}>
            <DateTimePicker
              value={dob ?? latestAdultDob()}
              mode="date"
              // Spinner on iOS: a calendar grid is a poor way to travel twenty
              // years back, which is the only journey this picker ever makes.
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              // An underage date cannot be chosen at all. A disabled range is
              // kinder — and less alarming — than a rejection after the fact.
              maximumDate={latestAdultDob()}
              minimumDate={earliestDob()}
              onChange={handlePicked}
              themeVariant="dark"
            />
            {Platform.OS === 'ios' && (
              <Button
                label={t('common.done')}
                onPress={() => setPickerOpen(false)}
                variant="secondary"
                size="sm"
                fullWidth
              />
            )}
          </Animated.View>
        )}
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(300).delay(180)} style={styles.section}>
        <Column gap="sm">
          <Text variant="caption" tone="secondary">
            {t('auth.genderLabel')}
          </Text>
          <Row gap="sm" wrap>
            {GENDERS.map((option) => (
              <Chip
                key={option.value}
                label={t(option.label)}
                selected={gender === option.value}
                onPress={() => {
                  haptic.selection();
                  setGender(option.value);
                }}
                disabled={save.isPending}
              />
            ))}
          </Row>
        </Column>
      </Animated.View>

      {showBanner && (
        <View style={styles.section}>
          <Banner message={errorMessage(save.error)} detail={traceReference(save.error)} />
        </View>
      )}

      <View style={styles.footer}>
        <Button
          label={t('auth.finish')}
          onPress={submit}
          disabled={!nameIsValid || !dobIsValid}
          loading={save.isPending}
          size="lg"
          fullWidth
          testID="finish-profile"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: spacing.lg, marginBottom: spacing.xl },
  section: { marginTop: spacing.xl },
  dobField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
  },
  dobFieldError: { borderColor: colors.status.danger },
  dobFieldPressed: { backgroundColor: colors.bg.pressed },
  picker: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
    gap: spacing.sm,
  },
  footer: { marginTop: spacing.xxl, marginBottom: spacing.xl },
});
