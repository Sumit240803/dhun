import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useSearch } from '@/api/queries/useGrowth';
import type { PersonResult, RoomResult } from '@/api/types';
import { useTranslation } from '@/i18n';
import { track } from '@/lib/analytics';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { useDebounced } from '@/lib/useDebounced';
import { colors, radius, spacing } from '@/theme';
import { Badge, Banner, Column, EmptyState, Row, Screen, SearchBar, Skeleton, Text } from '@/ui';
import { themed } from '@/visuals/look';
import { LookAvatar } from '@/visuals/LookAvatar';

/**
 * Find someone.
 *
 * Most searches are for ONE person a user already has in mind — a host who
 * told them the app's name, or read out their ID on stream. So a person who is
 * live opens straight into their room, and everyone else opens their profile:
 * the result goes where the searcher was trying to get to.
 */
export default function DiscoverTab() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const settled = useDebounced(query, 300);
  const search = useSearch(settled);

  const trimmed = settled.trim();
  const people = search.data?.people ?? [];
  const rooms = search.data?.rooms ?? [];
  const typing = query.trim() !== trimmed;

  function openPerson(person: PersonResult) {
    haptic.tap();
    track('search_performed', { query_length: trimmed.length, result: 'person' });
    if (person.liveRoomId) {
      router.push({ pathname: '/(app)/room/[id]', params: { id: person.liveRoomId } });
    } else {
      router.push({ pathname: '/(app)/user/[id]', params: { id: person.userId } });
    }
  }

  function openRoom(room: RoomResult) {
    haptic.tap();
    track('search_performed', { query_length: trimmed.length, result: 'room' });
    router.push({ pathname: '/(app)/room/[id]', params: { id: room.id } });
  }

  return (
    <Screen padded={false} edges={['top']}>
      <View style={styles.search}>
        <Text variant="title">{t('discover.title')}</Text>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={t('discover.placeholder')}
          testID="discover-search"
        />
      </View>

      {trimmed === '' ? (
        <View style={styles.centre}>
          <EmptyState
            icon="search-outline"
            title={t('discover.idleTitle')}
            body={t('discover.idleBody')}
          />
        </View>
      ) : search.isError ? (
        <View style={styles.gutter}>
          <Banner message={errorMessage(search.error)} onRetry={() => void search.refetch()} />
        </View>
      ) : search.data === undefined ? (
        <Column gap="md" style={styles.gutter}>
          {Array.from({ length: 4 }, (_, index) => (
            <Row key={index} gap="md">
              <Skeleton width={44} height={44} rounding="pill" />
              <Skeleton width={160} height={16} />
            </Row>
          ))}
        </Column>
      ) : people.length === 0 && rooms.length === 0 && !typing ? (
        <View style={styles.centre}>
          <EmptyState
            icon="person-outline"
            title={t('discover.noneTitle', { query: trimmed })}
            body={t('discover.noneBody')}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled">
          {rooms.length > 0 && (
            <Section title={t('discover.liveRooms')}>
              {rooms.map((room) => (
                <Pressable
                  key={room.id}
                  onPress={() => openRoom(room)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  testID={`search-room-${room.id}`}
                >
                  <View style={styles.roomIcon}>
                    <Ionicons
                      name={room.party ? 'people' : 'mic'}
                      size={20}
                      color={colors.brand.accent}
                    />
                  </View>
                  <Column gap="xs" flex={1}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {room.title}
                    </Text>
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                      {room.hostName}
                    </Text>
                  </Column>
                  <Badge label={t('room.live')} tone="danger" />
                </Pressable>
              ))}
            </Section>
          )}

          {people.length > 0 && (
            <Section title={t('discover.people')}>
              {people.map((person) => (
                <Pressable
                  key={person.userId}
                  onPress={() => openPerson(person)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  testID={`search-person-${person.userId}`}
                >
                  <LookAvatar
                    uri={person.avatarUrl}
                    name={person.displayName}
                    size="md"
                    frame={person.look.frame}
                    live={person.liveRoomId !== null}
                  />
                  <Column gap="xs" flex={1}>
                    <Text
                      variant="bodyStrong"
                      numberOfLines={1}
                      style={
                        person.look.nameColor
                          ? { color: themed(person.look.nameColor).color }
                          : undefined
                      }
                    >
                      {person.displayName}
                    </Text>
                    <Text variant="caption" tone="secondary">
                      {t('profile.idLabel', { id: person.publicId })}
                    </Text>
                  </Column>
                  {person.liveRoomId !== null ? (
                    <Badge label={t('room.live')} tone="danger" />
                  ) : person.isFollowing ? (
                    <Text variant="micro" tone="faint">
                      {t('hostProfile.following')}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </Section>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.section}>
      <Text variant="micro" tone="faint" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </Text>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  search: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  gutter: { paddingHorizontal: spacing.lg },
  centre: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  results: { paddingBottom: spacing.xxl, gap: spacing.lg },
  section: { gap: spacing.xs },
  sectionTitle: { paddingHorizontal: spacing.lg, letterSpacing: 0.6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: { backgroundColor: colors.bg.pressed },
  roomIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.soft,
  },
});
