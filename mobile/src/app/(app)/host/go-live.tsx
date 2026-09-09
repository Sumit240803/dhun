import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useGoLive } from '@/api/queries/useRoom';
import { ApiErrorCode, type RoomTag } from '@/api/types';
import { useTranslation, type MessageKey } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { useIsRegistered } from '@/store/session';
import { Banner, Button, Card, Chip, Column, EmptyState, Input, Row, Screen, Text } from '@/ui';

const TAGS: { value: RoomTag; label: MessageKey }[] = [
  { value: 'chatting', label: 'room.tagChatting' },
  { value: 'singing', label: 'room.tagSinging' },
  { value: 'dancing', label: 'room.tagDancing' },
  { value: 'friends', label: 'room.tagFriends' },
  { value: 'gaming', label: 'room.tagGaming' },
  { value: 'esports', label: 'room.tagEsports' },
];

/** The default party size. Eight is what fits a phone screen without shrinking faces. */
const PARTY_SEATS = 8;

/**
 * Starting a broadcast.
 *
 * Three decisions and one button. Everything else a host might want to
 * configure — cover image, region, video — is either derived or deferred,
 * because the screen someone sees before going live for the first time is the
 * wrong place to ask eight questions.
 */
export default function GoLiveScreen() {
  const { t } = useTranslation();
  const goLive = useGoLive();
  const isRegistered = useIsRegistered();

  const [title, setTitle] = useState('');
  const [tag, setTag] = useState<RoomTag>('chatting');
  const [party, setParty] = useState(true);
  const [touched, setTouched] = useState(false);

  const trimmed = title.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 60;

  function start() {
    setTouched(true);
    if (!valid || goLive.isPending) return;

    haptic.tap();
    goLive.mutate(
      { title: trimmed, tag, ...(party ? { seatCapacity: PARTY_SEATS } : {}) },
      {
        onSuccess: (result) => {
          haptic.success();
          track('room_card_tapped', { role: 'host', tag });
          // replace, not push — backing out of a room you are hosting should
          // return to the tabs, not to the form that created it.
          router.replace({ pathname: '/(app)/room/[id]', params: { id: result.room.id } });
        },
        onError: () => haptic.error(),
      },
    );
  }

  // Already live is not really an error — the host has a room and almost
  // certainly wants to be in it. Offering the way there beats a red banner.
  const alreadyLive = isErrorCode(goLive.error, ApiErrorCode.ALREADY_LIVE);
  const existingRoomId = alreadyLive
    ? ((goLive.error as { details?: { roomId?: string } }).details?.roomId ?? null)
    : null;

  // Checked BEFORE the form, not after submitting it.
  //
  // The server refuses a guest with REGISTRATION_REQUIRED, which is correct —
  // but letting someone name a room, pick a tag, choose a type and only THEN
  // telling them they need an account wastes their effort and reads as a
  // failure rather than as a step they have not taken yet.
  if (!isRegistered) {
    return (
      <Screen padded>
        <Row style={styles.guestHeader} gap="md">
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            hitSlop={spacing.md}
          >
            <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
          </Pressable>
        </Row>
        <View style={styles.centre}>
          <EmptyState
            icon="mic-outline"
            title={t('room.guestTitle')}
            body={t('room.guestBody')}
            actionLabel={t('room.guestAction')}
            onAction={() => {
              haptic.tap();
              router.push('/(auth)');
            }}
            testID="go-live-signup"
          />
        </View>
      </Screen>
    );
  }

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
        <Text variant="heading">{t('room.goLiveTitle')}</Text>
      </Row>

      <View style={styles.body}>
        <Animated.View entering={FadeInDown.duration(280)}>
          <Column gap="xs" style={styles.intro}>
            <Text variant="title">{t('room.goLiveTitle')}</Text>
            <Text variant="body" tone="secondary">
              {t('room.goLiveSubtitle')}
            </Text>
          </Column>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(280).delay(60)}>
          <Column gap="xl">
            <Input
              label={t('room.roomTitle')}
              placeholder={t('room.roomTitlePlaceholder')}
              value={title}
              onChangeText={setTitle}
              onBlur={() => setTouched(true)}
              onSubmitEditing={start}
              error={touched && trimmed === '' ? t('room.roomTitle') : undefined}
              maxLength={60}
              returnKeyType="go"
              editable={!goLive.isPending}
              autoFocus
            />

            <Column gap="sm">
              <Text variant="caption" tone="secondary">
                {t('room.roomTag')}
              </Text>
              <Row gap="xs" wrap>
                {TAGS.map((item) => (
                  <Chip
                    key={item.value}
                    label={t(item.label)}
                    selected={tag === item.value}
                    onPress={() => {
                      haptic.selection();
                      setTag(item.value);
                    }}
                  />
                ))}
              </Row>
            </Column>

            <Column gap="sm">
              <Text variant="caption" tone="secondary">
                {t('room.roomType')}
              </Text>
              <Row gap="md">
                <TypeCard
                  icon="mic-outline"
                  title={t('room.typeSolo')}
                  hint={t('room.typeSoloHint')}
                  selected={!party}
                  onPress={() => {
                    haptic.selection();
                    setParty(false);
                  }}
                  testID="type-solo"
                />
                <TypeCard
                  icon="people-outline"
                  title={t('room.typeParty')}
                  hint={t('room.typePartyHint', { count: PARTY_SEATS })}
                  selected={party}
                  onPress={() => {
                    haptic.selection();
                    setParty(true);
                  }}
                  testID="type-party"
                />
              </Row>
            </Column>
          </Column>
        </Animated.View>

        {alreadyLive && existingRoomId !== null && (
          <View style={styles.banner}>
            <Card selected>
              <Column gap="md">
                <Text variant="bodyStrong">{t('room.alreadyLive')}</Text>
                <Button
                  label={t('room.openExisting')}
                  onPress={() => {
                    haptic.tap();
                    router.replace({
                      pathname: '/(app)/room/[id]',
                      params: { id: existingRoomId },
                    });
                  }}
                  size="sm"
                  testID="open-existing-room"
                />
              </Column>
            </Card>
          </View>
        )}

        {goLive.error != null && !alreadyLive && (
          <View style={styles.banner}>
            <Banner message={errorMessage(goLive.error)} detail={traceReference(goLive.error)} />
          </View>
        )}

        <View style={styles.spacer} />

        <KeyboardStickyView offset={{ closed: 0, opened: spacing.md }}>
          <Button
            label={t('room.startBroadcast')}
            onPress={start}
            disabled={!valid}
            loading={goLive.isPending}
            size="lg"
            fullWidth
            testID="start-broadcast"
          />
        </KeyboardStickyView>
      </View>
    </Screen>
  );
}

function TypeCard({
  icon,
  title,
  hint,
  selected,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.type, selected && styles.typeSelected]}
      testID={testID}
    >
      <Ionicons
        name={icon}
        size={22}
        color={selected ? colors.brand.accent : colors.text.secondary}
      />
      <Text variant="bodyStrong">{title}</Text>
      <Text variant="micro" tone="faint">
        {hint}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  guestHeader: { height: 44, marginLeft: -spacing.xs },
  centre: { flex: 1, justifyContent: 'center' },
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  intro: { marginBottom: spacing.xl },
  banner: { marginTop: spacing.lg },
  spacer: { flex: 1, minHeight: spacing.xl },
  type: {
    flex: 1,
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  typeSelected: { borderColor: colors.brand.accent, backgroundColor: colors.brand.soft },
});
