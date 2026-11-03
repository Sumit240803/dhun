import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useBanners, useRoomFeed } from '@/api/queries/useFeed';
import { useAppConfig } from '@/features/config/useAppConfig';
import { SearchResults } from '@/features/discover/SearchResults';
import { feedLanguage, useFeedLanguage } from '@/features/language/feedLanguage';
import { LanguagePickerSheet } from '@/features/language/LanguagePicker';
import { LANGUAGE_LABELS } from '@/features/language/languages';
import { NewUserEntry } from '@/features/rewards/newUser/NewUserEntry';
import { peakWindow } from '@/features/rewards/schedule';
import { useTranslation, type MessageKey } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import type { AppBanner, FeedCategory, FeedRoom, RoomTag } from '@/api/types';
import { colors, radius, spacing } from '@/theme';
import { useSession } from '@/store/session';
import {
  Banner,
  EmptyState,
  Fab,
  fabClearance,
  Screen,
  SearchBar,
  SegmentedTabs,
  Skeleton,
  Text,
  useSectionSwipe,
  type SheetHandle,
} from '@/ui';
import { BannerCarousel } from '@/visuals/BannerCarousel';
import { RoomCard } from '@/visuals/RoomCard';

const SECTION_LABELS: Record<string, MessageKey> = {
  following: 'feed.following',
  explore: 'feed.explore',
  party: 'feed.party',
  trending: 'feed.trending',
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

  // "Nearby" is a language, never a place (build-plan M20). Shared by both
  // feed tabs and remembered on the device; null is every language.
  const language = useFeedLanguage();
  const ownLanguages = useSession().user?.languages ?? [];
  const languageSheet = useRef<SheetHandle>(null);
  useEffect(() => {
    void feedLanguage.load();
  }, []);

  const feed = useRoomFeed(category, language);
  const banners = useBanners();

  // An empty feed outside peak hours says when to come back. "Nothing here"
  // at 3pm is the moment a new user decides the app is dead.
  const { coldStart } = useAppConfig();
  const peak = coldStart ? peakWindow(coldStart) : null;

  // Swipe between sections, the way every app in this category does. The
  // gesture is on the list only — putting it on the whole Screen would fight
  // the banner carousel and the section row, both of which scroll sideways.
  const swipe = useSectionSwipe({ sections, value: category, onChange: setCategory });

  // Filters what is ALREADY loaded, by host name. Immediate, and honest about
  // its scope — a search across every live room is a server query and its own
  // screen (M10). Previously this bar set state nothing ever read.
  // Typing searches the whole app, not the cards already loaded: a host's ID
  // or a room code read out on stream has to find them even when their room
  // is not on this page.
  const searching = query.trim() !== '';
  const visible = feed.data ?? [];

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
      {/*
        The language control sits where the reference feed keeps its region
        picker — right of the section tabs (app-reference-images, Screenshot
        2026-10-06 124605, "Global ▾").
      */}
      <View style={styles.tabsRow}>
        <View style={styles.tabs}>
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
        </View>
        <Pressable
          onPress={() => {
            haptic.tap();
            languageSheet.current?.present();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('language.filterLabel', {
            language: language === null ? t('language.all') : t(LANGUAGE_LABELS[language]),
          })}
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.languagePill, pressed && styles.languagePillPressed]}
          testID="feed-language"
        >
          <Ionicons
            name="language-outline"
            size={16}
            color={language === null ? colors.text.secondary : colors.brand.accent}
          />
          <Text
            variant="caption"
            tone={language === null ? 'secondary' : 'brand'}
            numberOfLines={1}
            style={styles.languageText}
          >
            {language === null ? t('language.all') : t(LANGUAGE_LABELS[language])}
          </Text>
          <Ionicons name="chevron-down" size={14} color={colors.text.faint} />
        </Pressable>
      </View>

      <View style={styles.search}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={t('feed.searchPlaceholder')}
          testID="feed-search"
        />
      </View>

      {searching ? (
        <SearchResults query={query} />
      ) : (
        <GestureDetector gesture={swipe}>
          {/*
          Keyed on the section so the list remounts and fades in. Without it,
          swiping swaps the data under a stationary scroll position and the new
          section appears already scrolled halfway down.
        */}
          <Animated.View key={category} entering={FadeIn.duration(160)} style={styles.listWrapper}>
            <FlashList
              data={visible}
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
                ) : feed.isError ? null : language !== null ? (
                  // Narrowed and empty: name the language and offer the way out,
                  // rather than a generic "nothing live" that hides the filter.
                  <EmptyState
                    icon="language-outline"
                    title={t('language.emptyTitle', { language: t(LANGUAGE_LABELS[language]) })}
                    body={t('language.emptyBody', { language: t(LANGUAGE_LABELS[language]) })}
                    actionLabel={t('language.emptyAction')}
                    onAction={() => {
                      haptic.tap();
                      feedLanguage.set(null);
                    }}
                    testID="feed-empty-language"
                  />
                ) : category === 'following' ? (
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
                ) : category === 'trending' ? (
                  // Trending is the hourly board's current hour, so at the top
                  // of a quiet hour it is honestly empty. Say so rather than
                  // padding it with rooms nobody is gifting in.
                  <EmptyState
                    icon="flame-outline"
                    title={t('feed.emptyTrendingTitle')}
                    body={t('feed.emptyTrendingBody')}
                    testID="feed-empty-trending"
                  />
                ) : (
                  <EmptyState
                    icon={peak && !peak.live ? 'moon-outline' : 'videocam-outline'}
                    title={
                      peak && !peak.live && coldStart
                        ? t('feed.peakTitle', {
                            start: coldStart.peakStartIst,
                            end: coldStart.peakEndIst,
                          })
                        : t('feed.emptyTitle')
                    }
                    body={
                      peak && !peak.live
                        ? t('feed.peakBody', {
                            hours: Math.floor(peak.startsInMinutes / 60),
                            minutes: peak.startsInMinutes % 60,
                          })
                        : t('feed.emptyBody')
                    }
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
      )}

      <Fab
        label={action === 'party' ? t('feed.startParty') : t('feed.goLive')}
        icon={action === 'party' ? 'people' : 'videocam'}
        onPress={() => {
          haptic.tap();
          router.push('/(app)/host/go-live');
        }}
        testID="go-live"
      />

      {/* On both feeds, above the Fab, for as long as the window is open. */}
      <NewUserEntry />

      <LanguagePickerSheet
        ref={languageSheet}
        title={t('language.pickerTitle')}
        value={language}
        own={ownLanguages}
        allowAll
        onPick={(next) => {
          track('feed_language_selected', { language: next ?? 'all', category });
          feedLanguage.set(next);
        }}
        testID="feed-language"
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
  tabsRow: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.lg },
  // Takes what the pill leaves; the tabs scroll sideways inside it if needed.
  tabs: { flex: 1 },
  languagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 140,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.raised,
  },
  languagePillPressed: { backgroundColor: colors.bg.pressed },
  languageText: { flexShrink: 1 },
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
