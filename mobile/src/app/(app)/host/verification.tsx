import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { useProfileSummary } from '@/api/queries/useFeed';
import { useMyVerification, useSubmitVerification } from '@/api/queries/useVerification';
import type { HostVerification } from '@/api/types';
import { uploadImage, type PickedImage } from '@/features/media/upload';
import { SelfieFrame } from '@/features/verification/SelfieFrame';
import { verificationSteps, type StepState } from '@/features/verification/steps';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { useSession } from '@/store/session';
import { colors, radius, spacing } from '@/theme';
import { Banner, Button, Card, Column, Divider, ListItem, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * Host identity verification — the "Auth" entry on the reference's Me screen.
 *
 * Two steps, one screen: the phone number (already verified for most accounts)
 * and a face photo a person reviews. Said plainly at the top WHY it exists —
 * it is what lets a host withdraw — because a verification whose purpose is
 * vague gets put off, and a host who puts it off finds out at payout time.
 *
 * The photo is reviewed by a human, not a vendor (docs/face-verification.md),
 * so the screen's job after submitting is to say "under review" clearly and
 * then get out of the way.
 */
export default function VerificationScreen() {
  const { t, locale } = useTranslation();
  const { user } = useSession();
  const summary = useProfileSummary();
  const verification = useMyVerification();
  const submit = useSubmitVerification();

  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const status = verification.data?.status ?? 'none';
  // The server's answer when it has arrived; the session's phone until then.
  const phoneVerified = summary.data?.verified ?? user?.phone != null;
  const steps = verificationSteps({ phoneVerified, status });
  const sending = uploading || submit.isPending;

  async function takePhoto() {
    if (capturing || sending) return;
    haptic.tap();
    setLocalError(null);
    setCapturing(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setLocalError(t('verification.cameraDenied'));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        cameraType: ImagePicker.CameraType.front,
        mediaTypes: ['images'],
        allowsEditing: false,
        // A reviewer needs to recognise a face. 0.7 keeps it to a few hundred
        // KB on a cheap phone and a slow connection.
        quality: 0.7,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0]!;
      setPhoto({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'image/jpeg',
        fileSize: asset.fileSize,
      });
      haptic.selection();
    } catch (err) {
      haptic.error();
      setLocalError(errorMessage(err));
    } finally {
      setCapturing(false);
    }
  }

  async function send() {
    if (photo === null || sending) return;
    haptic.tap();
    setLocalError(null);
    setUploading(true);
    try {
      // The avatar purpose: same size limit, same per-user prefix, and the
      // server's claimUpload proves the key is this host's before it is kept.
      const key = await uploadImage('avatar', photo);
      submit.mutate(key, {
        onSuccess: () => {
          haptic.success();
          setPhoto(null);
        },
        onError: () => haptic.error(),
      });
    } catch (err) {
      haptic.error();
      setLocalError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  const reviewedOn =
    verification.data?.reviewedAt != null
      ? new Date(verification.data.reviewedAt).toLocaleDateString(
          locale === 'hi' ? 'hi-IN' : 'en-IN',
          { day: 'numeric', month: 'long', year: 'numeric' },
        )
      : '';

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
        <Text variant="heading">{t('verification.title')}</Text>
      </Row>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(280)}>
          <Column gap="xs">
            <Text variant="title">{t('verification.heading')}</Text>
            <Text variant="body" tone="secondary">
              {t('verification.intro')}
            </Text>
          </Column>
        </Animated.View>

        {verification.isError ? (
          <Banner
            message={errorMessage(verification.error)}
            onRetry={() => void verification.refetch()}
          />
        ) : verification.data === undefined ? (
          <Column gap="lg">
            <Skeleton height={112} rounding="lg" />
            <Skeleton height={280} rounding="xl" />
          </Column>
        ) : (
          <Animated.View entering={FadeInDown.duration(280).delay(60)} style={styles.body}>
            {status !== 'none' && (
              <StatusStrip verification={verification.data} reviewedOn={reviewedOn} />
            )}

            <Card padded={false}>
              <StepRow
                index={1}
                state={steps.phone}
                title={t('verification.stepPhone')}
                subtitle={
                  steps.phone === 'done'
                    ? t('verification.phoneVerified', { phone: user?.phone ?? '' })
                    : t('verification.phoneMissing')
                }
                onPress={
                  steps.phone === 'done'
                    ? undefined
                    : () => {
                        haptic.selection();
                        router.push('/(app)/account/phone');
                      }
                }
                testID="step-phone"
              />
              <Divider />
              <StepRow
                index={2}
                state={steps.face}
                title={t('verification.stepFace')}
                subtitle={
                  steps.face === 'done'
                    ? t('verification.faceDone')
                    : steps.face === 'pending'
                      ? t('verification.facePending')
                      : steps.face === 'retry'
                        ? t('verification.faceRetry')
                        : t('verification.faceHint')
                }
                testID="step-face"
              />
            </Card>

            {steps.canSubmit && (
              <Column gap="md">
                <SelfieFrame
                  uri={photo?.uri ?? null}
                  busy={capturing}
                  disabled={sending}
                  onPress={() => void takePhoto()}
                />
                <Text variant="caption" tone="faint" style={styles.centred}>
                  {t('verification.privacy')}
                </Text>
              </Column>
            )}

            {(localError !== null || submit.error != null) && (
              <Banner message={localError ?? errorMessage(submit.error)} />
            )}
            {submit.isSuccess && status === 'pending' && (
              <Animated.View entering={FadeIn.duration(200)}>
                <Text variant="bodyStrong" tone="brand" style={styles.centred}>
                  {t('verification.submitted')}
                </Text>
              </Animated.View>
            )}
          </Animated.View>
        )}
      </ScrollView>

      {verification.data !== undefined && steps.canSubmit && (
        <View style={styles.footer}>
          <Button
            label={t('verification.submit')}
            onPress={() => void send()}
            disabled={photo === null}
            loading={sending}
            size="lg"
            fullWidth
            testID="verification-submit"
          />
        </View>
      )}
    </Screen>
  );
}

/** Where the review stands, in one line a host can act on. */
function StatusStrip({
  verification,
  reviewedOn,
}: {
  verification: HostVerification;
  reviewedOn: string;
}) {
  const { t } = useTranslation();

  const look =
    verification.status === 'approved'
      ? {
          bg: colors.status.successSoft,
          fg: colors.status.success,
          icon: 'checkmark-circle' as const,
          title: t('verification.approvedTitle'),
          body: t('verification.approvedBody', { date: reviewedOn }),
        }
      : verification.status === 'rejected'
        ? {
            bg: colors.status.dangerSoft,
            fg: colors.status.danger,
            icon: 'alert-circle' as const,
            title: t('verification.rejectedTitle'),
            body: t('verification.rejectedBody'),
          }
        : {
            bg: colors.status.warningSoft,
            fg: colors.status.warning,
            icon: 'time' as const,
            title: t('verification.pendingTitle'),
            body: t('verification.pendingBody'),
          };

  return (
    <View
      style={[styles.strip, { backgroundColor: look.bg }]}
      testID={`status-${verification.status}`}
    >
      <Ionicons name={look.icon} size={22} color={look.fg} />
      <Column gap="xs" flex={1}>
        <Text variant="bodyStrong">{look.title}</Text>
        <Text variant="caption" tone="secondary">
          {look.body}
        </Text>
        {verification.status === 'rejected' && verification.note && (
          <Text variant="caption" tone="secondary">
            {t('verification.reviewerNote', { note: verification.note })}
          </Text>
        )}
      </Column>
    </View>
  );
}

function StepRow({
  index,
  state,
  title,
  subtitle,
  onPress,
  testID,
}: {
  index: number;
  state: StepState;
  title: string;
  subtitle: string;
  onPress?: () => void;
  testID: string;
}) {
  return (
    <ListItem
      title={title}
      subtitle={subtitle}
      left={<StepBadge index={index} state={state} />}
      right={
        state === 'done' ? (
          <Ionicons name="checkmark-circle" size={20} color={colors.status.success} />
        ) : onPress ? (
          <Ionicons name="chevron-forward" size={18} color={colors.text.faint} />
        ) : undefined
      }
      onPress={onPress}
      testID={testID}
    />
  );
}

/** The step number, or what has become of it. */
function StepBadge({ index, state }: { index: number; state: StepState }) {
  const palette =
    state === 'done'
      ? { bg: colors.status.successSoft, fg: colors.status.success }
      : state === 'pending'
        ? { bg: colors.status.warningSoft, fg: colors.status.warning }
        : state === 'retry'
          ? { bg: colors.status.dangerSoft, fg: colors.status.danger }
          : { bg: colors.brand.soft, fg: colors.brand.accent };

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      {state === 'done' ? (
        <Ionicons name="checkmark" size={14} color={palette.fg} />
      ) : state === 'pending' ? (
        <Ionicons name="time-outline" size={14} color={palette.fg} />
      ) : (
        <Text variant="micro" style={{ color: palette.fg }}>
          {index}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  body: { gap: spacing.lg },
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
