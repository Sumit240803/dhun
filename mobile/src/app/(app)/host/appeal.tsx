import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { useFileAppeal, useMyAppeal } from '@/api/queries/useAppeal';
import type { MyAppeal } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing, typography } from '@/theme';
import { Banner, Button, Column, EmptyState, Row, Screen, Skeleton, Text } from '@/ui';

const MIN = 20;
const MAX = 1000;

/**
 * Appealing a suspension.
 *
 * The screen a suspended host reaches from the go-live door and from the card
 * on their profile. It says plainly what the suspension means for them, lets
 * them say what happened once, and then reports what a SECOND reviewer
 * decided — the one promise this flow makes (docs/face-verification.md § 7:
 * "suspension is a moderation decision with an appeal").
 *
 * The moderator's reason for the suspension is not shown; it was written for
 * the log. The reviewer's note on the appeal is, because it is written for
 * the host.
 */
export default function AppealScreen() {
  const { t, locale } = useTranslation();
  const appeal = useMyAppeal();
  const file = useFileAppeal();
  const [message, setMessage] = useState('');
  const [focused, setFocused] = useState(false);

  const trimmed = message.trim();
  const ready = trimmed.length >= MIN && trimmed.length <= MAX;

  const date = (iso: string | null) =>
    iso === null
      ? ''
      : new Date(iso).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
          day: 'numeric',
          month: 'long',
        });

  function send() {
    if (!ready || file.isPending) return;
    haptic.tap();
    file.mutate(trimmed, {
      onSuccess: () => {
        haptic.success();
        setMessage('');
      },
      onError: () => haptic.error(),
    });
  }

  const data = appeal.data;
  const canFile = data?.suspended === true && data.appeal === null;

  return (
    <Screen padded={false} edges={['top', 'bottom']}>
      <Row style={styles.header} gap="md">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={spacing.md}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
        </Pressable>
        <Text variant="heading">{t('appeal.title')}</Text>
      </Row>

      {appeal.isError ? (
        <View style={styles.gutter}>
          <Banner message={errorMessage(appeal.error)} onRetry={() => void appeal.refetch()} />
        </View>
      ) : data === undefined ? (
        <Column gap="lg" style={styles.gutter}>
          <Skeleton height={80} rounding="lg" />
          <Skeleton height={160} rounding="lg" />
        </Column>
      ) : !data.suspended && data.appeal === null ? (
        <View style={styles.centre}>
          <EmptyState
            icon="shield-checkmark-outline"
            title={t('appeal.clearTitle')}
            body={t('appeal.clearBody')}
            testID="appeal-clear"
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={FadeInDown.duration(280)}>
            <Column gap="xs">
              <Text variant="title">
                {data.suspended ? t('appeal.suspendedTitle') : t('appeal.overturnedTitle')}
              </Text>
              {data.suspended && (
                <Text variant="body" tone="secondary">
                  {t('appeal.suspendedBody', { date: date(data.suspendedAt) })}
                </Text>
              )}
            </Column>
          </Animated.View>

          {data.appeal !== null && (
            <Animated.View entering={FadeInDown.duration(280).delay(60)} style={styles.body}>
              <Outcome appeal={data.appeal} reviewedOn={date(data.appeal.reviewedAt)} />
              <Column gap="xs">
                <Text variant="micro" tone="faint" style={styles.label}>
                  {t('appeal.yourWords').toUpperCase()}
                </Text>
                <View style={styles.quote}>
                  <Text variant="body" tone="secondary">
                    {data.appeal.message}
                  </Text>
                </View>
              </Column>
            </Animated.View>
          )}

          {canFile && (
            <Animated.View entering={FadeInDown.duration(280).delay(60)} style={styles.body}>
              <Column gap="xs">
                <Text variant="caption" tone="secondary">
                  {t('appeal.formLabel')}
                </Text>
                <View
                  style={[
                    styles.field,
                    { borderColor: focused ? colors.border.focus : colors.border.subtle },
                  ]}
                >
                  <TextInput
                    value={message}
                    onChangeText={setMessage}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder={t('appeal.formPlaceholder')}
                    placeholderTextColor={colors.text.faint}
                    multiline
                    maxLength={MAX}
                    textAlignVertical="top"
                    editable={!file.isPending}
                    style={styles.input}
                    accessibilityLabel={t('appeal.formLabel')}
                    testID="appeal-message"
                  />
                </View>
                <Row justify="between">
                  <Text variant="micro" tone="faint" style={styles.helper}>
                    {t('appeal.formHelper')}
                  </Text>
                  <Text
                    variant="micro"
                    tone={trimmed.length > 0 && trimmed.length < MIN ? 'danger' : 'faint'}
                    style={styles.counter}
                  >
                    {t('appeal.counter', { count: trimmed.length, max: MAX })}
                  </Text>
                </Row>
              </Column>

              {file.error != null && <Banner message={errorMessage(file.error)} />}
            </Animated.View>
          )}

          {file.isSuccess && (
            <Animated.View entering={FadeIn.duration(200)}>
              <Text variant="bodyStrong" tone="brand" style={styles.centred}>
                {t('appeal.sent')}
              </Text>
            </Animated.View>
          )}

          <Button
            label={t('appeal.grievance')}
            onPress={() => {
              haptic.selection();
              router.push('/legal/grievance');
            }}
            variant="ghost"
            fullWidth
          />
        </ScrollView>
      )}

      {canFile && (
        <KeyboardStickyView offset={{ closed: 0, opened: spacing.md }}>
          <View style={styles.footer}>
            <Button
              label={t('appeal.send')}
              onPress={send}
              disabled={!ready}
              loading={file.isPending}
              size="lg"
              fullWidth
              testID="appeal-send"
            />
          </View>
        </KeyboardStickyView>
      )}
    </Screen>
  );
}

/** What became of the appeal, in one strip. */
function Outcome({
  appeal,
  reviewedOn,
}: {
  appeal: NonNullable<MyAppeal['appeal']>;
  reviewedOn: string;
}) {
  const { t } = useTranslation();
  const look =
    appeal.status === 'overturned'
      ? {
          bg: colors.status.successSoft,
          fg: colors.status.success,
          icon: 'checkmark-circle' as const,
          title: t('appeal.overturnedTitle'),
          body: t('appeal.overturnedBody', { date: reviewedOn }),
        }
      : appeal.status === 'upheld'
        ? {
            bg: colors.status.dangerSoft,
            fg: colors.status.danger,
            icon: 'alert-circle' as const,
            title: t('appeal.upheldTitle'),
            body: t('appeal.upheldBody', { date: reviewedOn }),
          }
        : {
            bg: colors.status.warningSoft,
            fg: colors.status.warning,
            icon: 'time' as const,
            title: t('appeal.pendingTitle'),
            body: t('appeal.pendingBody'),
          };

  return (
    <View style={[styles.strip, { backgroundColor: look.bg }]} testID={`appeal-${appeal.status}`}>
      <Ionicons name={look.icon} size={22} color={look.fg} />
      <Column gap="xs" flex={1}>
        <Text variant="bodyStrong">{look.title}</Text>
        <Text variant="caption" tone="secondary">
          {look.body}
        </Text>
        {appeal.note && (
          <Text variant="caption" tone="secondary">
            {t('appeal.reviewerNote', { note: appeal.note })}
          </Text>
        )}
      </Column>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  gutter: { paddingHorizontal: spacing.lg },
  centre: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  body: { gap: spacing.lg },
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  label: { letterSpacing: 0.6, marginLeft: spacing.xs },
  quote: {
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.border.strong,
  },
  field: {
    minHeight: 148,
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.bg.surface,
  },
  input: { ...typography.body, color: colors.text.primary, padding: 0, minHeight: 112 },
  helper: { flexShrink: 1, paddingRight: spacing.md },
  counter: { fontVariant: ['tabular-nums'] },
  centred: { textAlign: 'center' },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.subtle,
    backgroundColor: colors.bg.base,
  },
});
