import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useBanners, useRoomFeed } from '@/api/queries/useFeed';
import { useTranslation, type MessageKey } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import type { AppBanner, FeedCategory, FeedRoom, RoomTag } from '@/api/types';
import { colors, spacing } from '@/theme';
import {
  Banner,
  EmptyState,
  Fab,
  fabClearance,
  Screen,
  SearchBar,
  SegmentedTabs,
  Skeleton,
  useSectionSwipe,
} from '@/ui';
import { BannerCarousel } from '@/visuals/BannerCarousel';
import { RoomCard } from '@/visuals/RoomCard';

const SECTION_LABELS: Record<string, MessageKey> = {
  following: 'feed.following',
  explore: 'feed.explore',
  party: 'feed.party',
};

const TAG_LABELS: Record<RoomTag, MessageKey> = {
  singing: 'feed.tagSinging',
  dancing: 'feed.tagDancing',
  chatting: 'feed.tagChatting',
  gaming: 'feed.tagGaming',
  friends: 'feed.tagFriends',
  esports: 'feed.tagEsports',
};

export interface RoomFeedProps {
  /**
   * Which sections this tab offers, in order. The first is the default.
   *
   * Live and Party are separate TABS but the same screen: the card, the
   * banners, the search and every empty state are identical, and only the
   * sections differ. Two copies of this file would drift within a month.
   */
  sections: FeedCategory[];
  /** The floating action this tab provokes. */
  action: 'live' | 'party';
}

export function RoomFeed({ sections, action }: RoomFeedProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<FeedCategory>(sections[0]);
  const [query, setQuery] = useState('');

  const feed = useRoomFeed(category);
  const banners = useBanners();

  // Swipe between sections, the way every app in this category does. The
  // gesture is on the list only — putting it on the whole Screen would fight
  // the banner carousel and the section row, both of which scroll sideways.
  const swipe = useSectionSwipe({ sections, value: category, onChange: setCategory });

  function openRoom(room: FeedRoom) {
    haptic.tap();
    track('room_card_tapped', { room_id: room.id, category });
    router.push({ pathname: '/(app)/room/[id]', params: { id: room.id } });
  }

  function openBanner(banner: AppBanner) {
    haptic.tap();
    if (banner.action === 'topup') router.push('/(app)/wallet');
  }

  return (
    <Screen padded={false} edges={['top']}>
      <SegmentedTabs
        options={sections.map((section) => ({
          value: section,
          label: t(SECTION_LABELS[section]),
        }))}
        value={category}
        onChange={(next) => {
          haptic.selection();
          setCategory(next);
        }}
        testID="feed-tabs"
      />

      <View style={styles.search}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={t('feed.searchPlaceholder')}
          testID="feed-search"
        />
      </View>

      <GestureDetector gesture={swipe}>
        {/*
          Keyed on the section so the list remounts and fades in. Without it,
          swiping swaps the data under a stationary scroll position and the new
          section appears already scrolled halfway down.
        */}
        <Animated.View key={category} entering={FadeIn.duration(160)} style={styles.listWrapper}>
          <FlashList
            data={feed.data ?? []}
            numColumns={2}
            keyExtractor={(room) => room.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={feed.isRefetching}
                onRefresh={() => void feed.refetch()}
                tintColor={colors.brand.solid}
                colors={[colors.brand.solid]}
              />
            }
            ListHeaderComponent={
              <View style={styles.header}>
                {banners.data !== undefined && (
                  <BannerCarousel banners={banners.data} onPress={openBanner} />
                )}
                {feed.isError && (
                  <View style={styles.gutter}>
                    <Banner
                      message={errorMessage(feed.error)}
                      onRetry={() => void feed.refetch()}
                      testID="feed-error"
                    />
                  </View>
                )}
              </View>
            }
            // Loading, empty and error are all designed states here rather than
            // afterthoughts — this list is empty on a new account by definition.
            ListEmptyComponent={
              feed.isLoading ? (
                <FeedSkeleton />
              ) : feed.isError ? null : category === 'following' ? (
                <EmptyState
                  icon="heart-outline"
                  title={t('feed.emptyFollowingTitle')}
                  body={t('feed.emptyFollowingBody')}
                  actionLabel={t('feed.emptyFollowingAction')}
                  onAction={() => {
                    haptic.tap();
                    setCategory(sections.find((section) => section !== 'following') ?? 'explore');
                  }}
                  testID="feed-empty-following"
                />
              ) : (
                <EmptyState
                  icon="videocam-outline"
                  title={t('feed.emptyTitle')}
                  body={t('feed.emptyBody')}
                  testID="feed-empty"
                />
              )
            }
            renderItem={({ item, index }) => (
              <View style={[styles.cell, index % 2 === 0 ? styles.cellLeft : styles.cellRight]}>
                <RoomCard
                  room={item}
                  tagLabel={t(TAG_LABELS[item.tag])}
                  onPress={() => openRoom(item)}
                  testID={`room-${item.id}`}
                />
              </View>
            )}
          />
        </Animated.View>
      </GestureDetector>

      <Fab
        label={action === 'party' ? t('feed.startParty') : t('feed.goLive')}
        icon={action === 'party' ? 'people' : 'videocam'}
        onPress={() => {
          haptic.tap();
          router.push('/(app)/host/go-live');
        }}
        testID="go-live"
      />
    </Screen>
  );
}

/** Two rows of cards, so the grid's shape is visible before its content is. */
function FeedSkeleton() {
  return (
    <View style={styles.skeleton}>
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={styles.skeletonCell}>
          <Skeleton height="100%" rounding="lg" />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  header: { gap: spacing.lg, paddingBottom: spacing.lg },
  gutter: { paddingHorizontal: spacing.lg },
  listWrapper: { flex: 1 },
  // Clears the floating button, NOT the tab bar — the screen already ends there.
  list: { paddingBottom: fabClearance },
  cell: { flex: 1, paddingBottom: spacing.md },
  cellLeft: { paddingLeft: spacing.lg, paddingRight: spacing.xs },
  cellRight: { paddingLeft: spacing.xs, paddingRight: spacing.lg },
  skeleton: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  skeletonCell: { width: '47%', aspectRatio: 0.82 },
});
