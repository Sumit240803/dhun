import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { useFriends, useOpenDirectThread } from '@/api/queries/useSocial';
import type { Friend } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Badge, Banner, EmptyState, Row, Screen, Skeleton, Text } from '@/ui';
import { themed } from '@/visuals/look';
import { LookAvatar } from '@/visuals/LookAvatar';

/**
 * Friends — people who follow you back.
 *
 * Who is live comes first, because that is the one thing on this list worth
 * acting on right now; the rest is newest friendship first. A row opens the
 * profile, the dot opens their room, and the bubble opens a conversation.
 * Nothing here is stored: the server derives the list from the follows that
 * exist, so it can never disagree with the counts on Me.
 */
export default function FriendsScreen() {
  const { t } = useTranslation();
  const friends = useFriends();
  const openChat = useOpenDirectThread();

  function message(friend: Friend) {
    haptic.tap();
    openChat.mutate(friend.userId, {
      onSuccess: ({ thread }) =>
        router.push({
          pathname: '/(app)/thread/[id]',
          params: { id: thread.id, title: thread.title },
        }),
      onError: () => haptic.error(),
    });
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
        <View style={styles.titles}>
          <Text variant="heading">{t('friends.title')}</Text>
          <Text variant="caption" tone="secondary">
            {t('friends.subtitle')}
          </Text>
        </View>
      </Row>

      {openChat.isError && (
        <View style={styles.gutter}>
          <Banner message={errorMessage(openChat.error)} />
        </View>
      )}

      <FlashList
        data={friends.data ?? []}
        keyExtractor={(friend) => friend.userId}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={friends.isRefetching}
            onRefresh={() => void friends.refetch()}
            tintColor={colors.brand.solid}
            colors={[colors.brand.solid]}
          />
        }
        ListEmptyComponent={
          friends.isLoading ? (
            <FriendSkeleton />
          ) : friends.isError ? (
            <View style={styles.gutter}>
              <Banner
                message={errorMessage(friends.error)}
                onRetry={() => void friends.refetch()}
              />
            </View>
          ) : (
            <EmptyState
              icon="people-outline"
              title={t('friends.emptyTitle')}
              body={t('friends.emptyBody')}
              actionLabel={t('friends.emptyAction')}
              onAction={() => {
                haptic.tap();
                router.push('/(app)/visitors');
              }}
              testID="friends-empty"
            />
          )
        }
        renderItem={({ item }) => (
          <FriendRow
            friend={item}
            liveLabel={t('friends.live')}
            levelLabel={t('hostProfile.level', { level: item.userLevel })}
            messageLabel={t('hostProfile.message')}
            onMessage={() => message(item)}
          />
        )}
      />
    </Screen>
  );
}

function FriendRow({
  friend,
  liveLabel,
  levelLabel,
  messageLabel,
  onMessage,
}: {
  friend: Friend;
  liveLabel: string;
  levelLabel: string;
  messageLabel: string;
  onMessage: () => void;
}) {
  const name = friend.displayName ?? friend.publicId;
  return (
    <Row gap="md" style={styles.row} testID={`friend-${friend.userId}`}>
      <Pressable
        onPress={() => {
          haptic.selection();
          if (friend.liveRoomId) {
            router.push({ pathname: '/(app)/room/[id]', params: { id: friend.liveRoomId } });
          } else {
            router.push({ pathname: '/(app)/user/[id]', params: { id: friend.userId } });
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={name}
        style={styles.identity}
      >
        <View>
          <LookAvatar uri={friend.avatarUrl} name={name} size="lg" frame={friend.look.frame} />
          {friend.liveRoomId !== null && <View style={styles.liveDot} />}
        </View>
        <View style={styles.body}>
          <Text
            variant="bodyStrong"
            numberOfLines={1}
            style={
              friend.look.nameColor ? { color: themed(friend.look.nameColor).color } : undefined
            }
          >
            {name}
          </Text>
          <Row gap="xs">
            {friend.liveRoomId !== null ? (
              <Badge label={liveLabel} tone="live" />
            ) : (
              <Badge label={levelLabel} tone="neutral" />
            )}
          </Row>
        </View>
      </Pressable>

      <Pressable
        onPress={onMessage}
        accessibilityRole="button"
        accessibilityLabel={messageLabel}
        hitSlop={spacing.sm}
        style={({ pressed }) => [styles.message, pressed && styles.messagePressed]}
        testID={`message-${friend.userId}`}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.brand.solid} />
      </Pressable>
    </Row>
  );
}

function FriendSkeleton() {
  return (
    <View style={styles.skeleton}>
      {Array.from({ length: 5 }, (_, index) => (
        <Row key={index} gap="md">
          <Skeleton width={48} height={48} rounding="pill" />
          <View style={styles.skeletonBody}>
            <Skeleton width="40%" height={14} />
            <Skeleton width="25%" height={12} />
          </View>
        </Row>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  titles: { flex: 1 },
  list: { paddingBottom: spacing.xxl },
  gutter: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  body: { flex: 1, gap: spacing.xs },
  liveDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.status.live,
    borderWidth: 2,
    borderColor: colors.bg.base,
  },
  message: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.soft,
  },
  messagePressed: { opacity: 0.7 },
  skeleton: { padding: spacing.lg, gap: spacing.xl },
  skeletonBody: { flex: 1, gap: spacing.sm },
});
