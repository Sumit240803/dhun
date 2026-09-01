import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useMarkThreadRead, useThreadMessages } from '@/api/queries/useSocial';
import type { ThreadMessage } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { colors, radius, spacing } from '@/theme';
import { Banner, EmptyState, Row, Screen, Skeleton, Text } from '@/ui';

export default function ThreadScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string; title?: string; official?: string }>();
  const threadId = params.id;

  const messages = useThreadMessages(threadId);
  const markRead = useMarkThreadRead();

  // Opening clears the badge. Not "scrolled to the bottom" — the stricter
  // version is more correct and nobody has ever thanked an app for it.
  useEffect(() => {
    if (threadId) markRead.mutate(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const isOfficial = params.official === '1';

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
        <Text variant="heading" numberOfLines={1} style={styles.title}>
          {params.title ?? ''}
        </Text>
        <View style={styles.headerSpacer} />
      </Row>

      <FlashList
        // Reversed to chronological. FlashList v2 dropped `inverted`, and for
        // these threads that is no loss: they are announcements of one or two
        // messages, and reading a notice from its start beats landing at the
        // end of it. Revisit when real conversations land in M5.
        data={[...(messages.data ?? [])].reverse()}
        keyExtractor={(message) => message.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          messages.isLoading ? (
            <MessageSkeleton />
          ) : messages.isError ? (
            <View style={styles.gutter}>
              <Banner
                message={errorMessage(messages.error)}
                onRetry={() => void messages.refetch()}
              />
            </View>
          ) : (
            <EmptyState
              icon="chatbubble-outline"
              title={t('thread.emptyTitle')}
              body={t('thread.emptyBody')}
            />
          )
        }
        renderItem={({ item }) => <Bubble message={item} />}
      />

      {isOfficial && (
        <View style={styles.notice}>
          <Ionicons name="information-circle" size={16} color={colors.text.faint} />
          <Text variant="caption" tone="faint" style={styles.noticeText}>
            {t('thread.officialNotice')}
          </Text>
        </View>
      )}
    </Screen>
  );
}

function Bubble({ message }: { message: ThreadMessage }) {
  return (
    <View style={[styles.bubbleRow, message.mine && styles.bubbleRowMine]}>
      <View style={[styles.bubble, message.mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text variant="body" tone={message.mine ? 'onBrand' : 'primary'}>
          {message.body}
        </Text>
        <Text variant="micro" tone={message.mine ? 'onBrand' : 'faint'} style={styles.time}>
          {new Date(message.createdAt).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>
    </View>
  );
}

function MessageSkeleton() {
  return (
    <View style={styles.skeleton}>
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} width="70%" height={56} rounding="lg" />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, height: 52 },
  title: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 26 },
  list: { padding: spacing.lg },
  gutter: { paddingHorizontal: spacing.lg },
  bubbleRow: { alignItems: 'flex-start', marginBottom: spacing.md },
  bubbleRowMine: { alignItems: 'flex-end' },
  bubble: { maxWidth: '82%', padding: spacing.md, borderRadius: radius.lg, gap: 2 },
  bubbleTheirs: {
    backgroundColor: colors.bg.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
  },
  bubbleMine: { backgroundColor: colors.brand.solid },
  time: { alignSelf: 'flex-end' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  noticeText: { flex: 1 },
  skeleton: { gap: spacing.md },
});
