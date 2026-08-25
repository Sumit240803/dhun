import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { useMessageThreads } from '@/api/queries/useFeed';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import type { MessageThread, ThreadFilter } from '@/api/types';
import { colors, radius, spacing } from '@/theme';
import {
  Avatar,
  Badge,
  Banner,
  Divider,
  EmptyState,
  Row,
  Screen,
  SegmentedTabs,
  Skeleton,
  Text,
} from '@/ui';

const ACCENT_ICONS: Record<MessageThread['accent'], keyof typeof Ionicons.glyphMap> = {
  money: 'cash',
  security: 'shield-checkmark',
  system: 'megaphone',
  person: 'person',
};

const ACCENT_COLOURS: Record<MessageThread['accent'], string> = {
  money: colors.status.success,
  security: colors.status.danger,
  system: colors.brand.solid,
  person: colors.currency.gem,
};

export default function MessagesTab() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ThreadFilter>('all');
  const threads = useMessageThreads(filter);

  const unread = (threads.data ?? []).reduce((sum, thread) => sum + thread.unread, 0);

  return (
    <Screen padded={false} edges={['top']}>
      <Row style={styles.header} justify="between">
        <Text variant="title">{t('messages.title')}</Text>
        <Row gap="md">
          <IconButton icon="add" label={t('messages.newChat')} />
          <IconButton icon="search" label={t('messages.search')} />
        </Row>
      </Row>

      <View style={styles.filters}>
        <SegmentedTabs
          variant="pill"
          options={[
            { value: 'all', label: t('messages.filterAll') },
            { value: 'official', label: t('messages.filterOfficial') },
            { value: 'unread', label: t('messages.filterUnread'), badge: unread },
            { value: 'groups', label: t('messages.filterGroups') },
          ]}
          value={filter}
          onChange={(next) => {
            haptic.selection();
            setFilter(next);
          }}
          testID="message-filters"
        />
      </View>

      <FlashList
        data={threads.data ?? []}
        keyExtractor={(thread) => thread.id}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={threads.isRefetching}
            onRefresh={() => void threads.refetch()}
            tintColor={colors.brand.solid}
            colors={[colors.brand.solid]}
          />
        }
        ItemSeparatorComponent={() => (
          <View style={styles.separator}>
            <Divider />
          </View>
        )}
        ListEmptyComponent={
          threads.isLoading ? (
            <ThreadSkeleton />
          ) : threads.isError ? (
            <View style={styles.gutter}>
              <Banner
                message={errorMessage(threads.error)}
                onRetry={() => void threads.refetch()}
              />
            </View>
          ) : filter === 'groups' ? (
            <EmptyState
              icon="people-outline"
              title={t('messages.emptyGroupsTitle')}
              body={t('messages.emptyGroupsBody')}
              testID="messages-empty-groups"
            />
          ) : (
            <EmptyState
              icon="chatbubbles-outline"
              title={t('messages.emptyTitle')}
              body={t('messages.emptyBody')}
              testID="messages-empty"
            />
          )
        }
        renderItem={({ item }) => (
          <ThreadRow thread={item} officialLabel={t('messages.official')} />
        )}
      />
    </Screen>
  );
}

function ThreadRow({ thread, officialLabel }: { thread: MessageThread; officialLabel: string }) {
  return (
    <Pressable
      onPress={() => haptic.selection()}
      accessibilityRole="button"
      accessibilityLabel={`${thread.title}. ${thread.preview}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`thread-${thread.id}`}
    >
      {thread.avatarUrl === null ? (
        <View style={[styles.glyph, { backgroundColor: ACCENT_COLOURS[thread.accent] }]}>
          <Ionicons name={ACCENT_ICONS[thread.accent]} size={22} color={colors.text.onMedia} />
        </View>
      ) : (
        <Avatar uri={thread.avatarUrl} name={thread.title} size="lg" />
      )}

      <View style={styles.body}>
        <Row gap="sm">
          <Text variant="bodyStrong" numberOfLines={1} style={styles.title}>
            {thread.title}
          </Text>
          {thread.official && <Badge label={officialLabel} tone="brand" />}
        </Row>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {thread.preview}
        </Text>
      </View>

      <View style={styles.meta}>
        <Text variant="micro" tone="faint">
          {formatTime(thread.updatedAt)}
        </Text>
        {thread.unread > 0 && (
          <View style={styles.unread}>
            <Text variant="micro" tone="onMedia">
              {thread.unread > 99 ? '99+' : String(thread.unread)}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

/**
 * Time only, because every thread in this list is recent by definition.
 *
 * Formatted on the client from an ISO string, never sent pre-formatted: the
 * server does not know the reader's timezone, and it certainly does not know
 * their locale.
 */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function IconButton({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <Pressable
      onPress={() => haptic.selection()}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={spacing.sm}
      style={({ pressed }) => [styles.iconButton, pressed && styles.rowPressed]}
    >
      <Ionicons name={icon} size={20} color={colors.text.primary} />
    </Pressable>
  );
}

function ThreadSkeleton() {
  return (
    <View style={styles.skeleton}>
      {Array.from({ length: 4 }, (_, index) => (
        <Row key={index} gap="md">
          <Skeleton width={48} height={48} rounding="pill" />
          <View style={styles.skeletonBody}>
            <Skeleton width="45%" height={14} />
            <Skeleton width="80%" height={12} />
          </View>
        </Row>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
  },
  filters: { paddingBottom: spacing.md },
  gutter: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  separator: { paddingLeft: 76 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg.surface,
  },
  rowPressed: { backgroundColor: colors.bg.pressed },
  glyph: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: { flexShrink: 1 },
  meta: { alignItems: 'flex-end', gap: spacing.xs },
  unread: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.status.live,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeleton: { padding: spacing.lg, gap: spacing.xl },
  skeletonBody: { flex: 1, gap: spacing.sm },
});
