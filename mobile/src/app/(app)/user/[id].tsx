import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usersApi } from '@/api/endpoints/feed';
import { queryKeys } from '@/api/queries/keys';
import { recordVisit } from '@/api/queries/useSocial';
import { ReportSheet } from '@/features/moderation/ReportSheet';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { useSession } from '@/store/session';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Column,
  EmptyState,
  Row,
  Screen,
  Sheet,
  Skeleton,
  Text,
  type SheetHandle,
} from '@/ui';

/**
 * Someone else's profile.
 *
 * This screen exists because the social graph had a write path and almost no
 * surface: follow worked, but the only place you could follow anyone was your
 * own visitors list. You could not follow a host you saw in the feed.
 *
 * It is also where report and block belong, which is what makes the app
 * submittable — store review requires a working report mechanism on
 * user-generated content.
 */
export default function UserProfileScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const params = useLocalSearchParams<{ id: string }>();
  const targetId = params.id;

  const reportSheet = useRef<SheetHandle>(null);
  const blockSheet = useRef<SheetHandle>(null);
  const moreSheet = useRef<SheetHandle>(null);
  const [blocking, setBlocking] = useState(false);

  const profile = useQuery({
    queryKey: queryKeys.profile.public(targetId),
    queryFn: async () => (await usersApi.profile(targetId)).profile,
    staleTime: 30_000,
    retry: false,
  });

  // Recorded once, on open. Fire-and-forget: a failed visit record is
  // invisible to everyone, where an error over a profile just opened is not.
  useEffect(() => {
    if (targetId && targetId !== user?.id) recordVisit(targetId);
  }, [targetId, user?.id]);

  const toggleFollow = useMutation({
    mutationFn: () =>
      profile.data?.isFollowing ? usersApi.unfollow(targetId) : usersApi.follow(targetId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.profile.public(targetId) });
      const previous = queryClient.getQueryData(queryKeys.profile.public(targetId));

      queryClient.setQueryData(
        queryKeys.profile.public(targetId),
        (current: typeof profile.data) =>
          current
            ? {
                ...current,
                isFollowing: !current.isFollowing,
                // The count moves with the button. Without this the number sits
                // one behind until a refetch and the screen looks broken.
                followers: current.followers + (current.isFollowing ? -1 : 1),
              }
            : current,
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(queryKeys.profile.public(targetId), context?.previous);
    },
    onSuccess: () => {
      track(profile.data?.isFollowing ? 'host_unfollowed' : 'host_followed', { host_id: targetId });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
    },
  });

  async function confirmBlock() {
    setBlocking(true);
    try {
      await usersApi.block(targetId);
      haptic.success();
      blockSheet.current?.dismiss();
      // Blocking hides their rooms everywhere, so nothing cached about them is
      // still true. Leaving the screen is the honest outcome.
      queryClient.removeQueries({ queryKey: queryKeys.profile.public(targetId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
      router.back();
    } catch {
      haptic.error();
    } finally {
      setBlocking(false);
    }
  }

  if (profile.isError) {
    return (
      <Screen padded edges={['top']}>
        <BackRow label={t('common.back')} />
        <EmptyState
          icon="person-remove-outline"
          title={t('hostProfile.notFound')}
          body={errorMessage(profile.error)}
        />
      </Screen>
    );
  }

  const data = profile.data;

  return (
    <Screen padded={false} edges={[]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={[colors.brand.soft, colors.bg.base]}
          style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}
        >
          <Row style={styles.heroBar} justify="between">
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              hitSlop={spacing.md}
            >
              <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
            </Pressable>
            <Pressable
              onPress={() => {
                haptic.selection();
                moreSheet.current?.present();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('hostProfile.more')}
              hitSlop={spacing.md}
              testID="profile-more"
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.text.primary} />
            </Pressable>
          </Row>

          <Animated.View entering={FadeInDown.duration(280)} style={styles.identity}>
            {data === undefined ? (
              <Skeleton width={96} height={96} rounding="pill" />
            ) : (
              <Avatar uri={data.avatarUrl} name={data.displayName} size="xl" />
            )}

            <Text variant="title" numberOfLines={1}>
              {data?.displayName ?? ''}
            </Text>

            {data !== undefined && (
              <Row gap="xs">
                <Badge label={t('hostProfile.level', { level: data.userLevel })} />
                <Badge label={t('profile.idLabel', { id: data.publicId })} tone="neutral" />
              </Row>
            )}

            {data?.bio ? (
              <Text variant="caption" tone="secondary" style={styles.bio}>
                {data.bio}
              </Text>
            ) : null}
          </Animated.View>
        </LinearGradient>

        <View style={styles.gutter}>
          <Row style={styles.stats}>
            <Stat label={t('hostProfile.followers')} value={data?.followers} />
            <Stat label={t('hostProfile.following')} value={data?.following} />
          </Row>

          <Column gap="md">
            <Button
              label={data?.isFollowing ? t('hostProfile.following') : t('hostProfile.follow')}
              onPress={() => {
                haptic.tap();
                toggleFollow.mutate();
              }}
              variant={data?.isFollowing ? 'secondary' : 'primary'}
              disabled={data === undefined}
              size="lg"
              fullWidth
              testID="toggle-follow"
            />

            {data?.liveRoomId != null ? (
              <Button
                label={t('hostProfile.watchLive')}
                onPress={() => {
                  haptic.tap();
                  router.push({
                    pathname: '/(app)/room/[id]',
                    params: { id: data.liveRoomId! },
                  });
                }}
                variant="ghost"
                fullWidth
              />
            ) : (
              <Text variant="caption" tone="faint" style={styles.notLive}>
                {t('hostProfile.notLive')}
              </Text>
            )}
          </Column>
        </View>
      </ScrollView>

      <Sheet ref={moreSheet}>
        <Column gap="sm">
          <Button
            label={t('hostProfile.report')}
            onPress={() => {
              moreSheet.current?.dismiss();
              // Presented after dismissal so two sheets never fight for the
              // same backdrop, which leaves the screen unresponsive.
              setTimeout(() => reportSheet.current?.present(), 250);
            }}
            variant="secondary"
            fullWidth
            testID="open-report"
          />
          <Button
            label={t('hostProfile.block')}
            onPress={() => {
              moreSheet.current?.dismiss();
              setTimeout(() => blockSheet.current?.present(), 250);
            }}
            variant="danger"
            fullWidth
            testID="open-block"
          />
          <Button
            label={t('common.cancel')}
            onPress={() => moreSheet.current?.dismiss()}
            variant="ghost"
            fullWidth
          />
        </Column>
      </Sheet>

      <Sheet ref={blockSheet} title={t('block.title', { name: data?.displayName ?? '' })}>
        <Text variant="body" tone="secondary">
          {t('block.body')}
        </Text>
        <Column gap="sm">
          <Button
            label={t('block.confirm')}
            onPress={confirmBlock}
            loading={blocking}
            variant="danger"
            fullWidth
            testID="confirm-block"
          />
          <Button
            label={t('common.cancel')}
            onPress={() => blockSheet.current?.dismiss()}
            variant="ghost"
            fullWidth
          />
        </Column>
      </Sheet>

      <ReportSheet ref={reportSheet} subjectType="user" subjectId={targetId} />

      {toggleFollow.isError && (
        <View style={styles.error}>
          <Banner message={errorMessage(toggleFollow.error)} />
        </View>
      )}
    </Screen>
  );
}

function BackRow({ label }: { label: string }) {
  return (
    <Row style={styles.backRow}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={spacing.md}
      >
        <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
      </Pressable>
    </Row>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <Column align="center" gap="xs" flex={1}>
      {value === undefined ? (
        <Skeleton width={28} height={22} />
      ) : (
        <Text variant="heading">{value}</Text>
      )}
      <Text variant="micro" tone="faint">
        {label}
      </Text>
    </Column>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: spacing.xxxl },
  hero: { paddingBottom: spacing.xl },
  heroBar: { paddingHorizontal: spacing.lg },
  identity: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  bio: { textAlign: 'center' },
  gutter: { paddingHorizontal: spacing.lg, gap: spacing.xl, marginTop: spacing.lg },
  stats: { paddingVertical: spacing.md },
  notLive: { textAlign: 'center' },
  backRow: { height: 44, marginLeft: -spacing.xs },
  error: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xxl },
});
