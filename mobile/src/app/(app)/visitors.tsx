import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { useMarkVisitorsSeen, useToggleFollow, useVisitors } from '@/api/queries/useSocial';
import type { Visitor } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Avatar, Banner, EmptyState, Row, Screen, Skeleton, Text } from '@/ui';

export default function VisitorsScreen() {
  const { t } = useTranslation();
  const visitors = useVisitors();
  const markSeen = useMarkVisitorsSeen();
  const toggleFollow = useToggleFollow();

  // Opening the list IS the acknowledgement. Fired once on mount rather than
  // on scroll — a badge that survives being looked at is worse than one
  // cleared a moment early.
  useEffect(() => {
    markSeen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <Text variant="heading">{t('visitors.title')}</Text>
          <Text variant="caption" tone="secondary">
            {t('visitors.subtitle')}
          </Text>
        </View>
      </Row>

      <FlashList
        data={visitors.data ?? []}
        keyExtractor={(visitor) => visitor.userId}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={visitors.isRefetching}
            onRefresh={() => void visitors.refetch()}
            tintColor={colors.brand.solid}
            colors={[colors.brand.solid]}
          />
        }
        ListEmptyComponent={
          visitors.isLoading ? (
            <VisitorSkeleton />
          ) : visitors.isError ? (
            <View style={styles.gutter}>
              <Banner
                message={errorMessage(visitors.error)}
                onRetry={() => void visitors.refetch()}
              />
            </View>
          ) : (
            <EmptyState
              icon="eye-outline"
              title={t('visitors.emptyTitle')}
              body={t('visitors.emptyBody')}
              testID="visitors-empty"
            />
          )
        }
        renderItem={({ item }) => (
          <VisitorRow
            visitor={item}
            followLabel={t('visitors.follow')}
            followingLabel={t('visitors.following')}
            onToggle={() => {
              haptic.selection();
              toggleFollow.mutate({ userId: item.userId, following: item.following });
            }}
          />
        )}
      />
    </Screen>
  );
}

function VisitorRow({
  visitor,
  followLabel,
  followingLabel,
  onToggle,
}: {
  visitor: Visitor;
  followLabel: string;
  followingLabel: string;
  onToggle: () => void;
}) {
  return (
    <Row gap="md" style={styles.row} testID={`visitor-${visitor.userId}`}>
      <Pressable
        onPress={() => {
          haptic.selection();
          router.push({ pathname: '/(app)/user/[id]', params: { id: visitor.userId } });
        }}
        accessibilityRole="button"
        accessibilityLabel={visitor.displayName}
        style={styles.identity}
      >
        <Avatar uri={visitor.avatarUrl} name={visitor.displayName} size="lg" />
        <View style={styles.body}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {visitor.displayName}
          </Text>
          <Text variant="caption" tone="faint">
            {relativeTime(visitor.visitedAt)}
          </Text>
        </View>
      </Pressable>

      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ selected: visitor.following }}
        accessibilityLabel={visitor.following ? followingLabel : followLabel}
        style={({ pressed }) => [
          styles.follow,
          visitor.following && styles.followingButton,
          pressed && styles.followPressed,
        ]}
        testID={`follow-${visitor.userId}`}
      >
        <Text variant="caption" tone={visitor.following ? 'secondary' : 'onBrand'}>
          {visitor.following ? followingLabel : followLabel}
        </Text>
      </Pressable>
    </Row>
  );
}

/**
 * "3h", "2d". Computed on the client from an ISO string.
 *
 * The server does not know the reader's timezone and certainly not their
 * locale, so it must never send a pre-formatted time.
 */
function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / (60 * 24))}d`;
}

function VisitorSkeleton() {
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
  gutter: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  body: { flex: 1, gap: 2 },
  follow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.solid,
  },
  followingButton: {
    backgroundColor: colors.bg.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
  followPressed: { opacity: 0.8 },
  skeleton: { padding: spacing.lg, gap: spacing.xl },
  skeletonBody: { flex: 1, gap: spacing.sm },
});
