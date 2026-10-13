import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Row, Text } from '@/ui';
import { themed } from '@/visuals/look';

import type { ChatLine } from '@/features/room/gateway';

/**
 * The three streams the references separate, and why.
 *
 * `all` is everything. `room` is arrivals, gifts and system notices — what
 * happened. `chat` is what people said. A busy room buries conversation under
 * join announcements within seconds, and the filter is how anyone follows a
 * conversation in a room of two hundred.
 */
export type ChatFilter = 'all' | 'room' | 'chat';

export interface RoomEventLine {
  id: string;
  kind: 'entry' | 'gift' | 'system';
  /** Pre-formatted by the caller — it owns the translations and the names. */
  text: string;
  /** The speaker's level, drawn as a chip. Absent for system lines. */
  level?: number;
}

type Row_ = { type: 'chat'; line: ChatLine } | { type: 'event'; line: RoomEventLine };

interface Props {
  chat: ChatLine[];
  events: RoomEventLine[];
  meId: string | undefined;
  /** The safety notice pinned at the top of every room. */
  notice: string;
  onNamePress: (userId: string, name: string | null) => void;
}

/**
 * The lower half of the room: who said what, and what happened.
 *
 * ── Why it is always on screen ──────────────────────────────────────────────
 *
 * Our room used to put seats and chat behind a segmented tab, so you could
 * watch OR talk. Every reference shows both at once, with the stage above and
 * the chat permanently below, and gifts flowing between them. That is the
 * single biggest reason their rooms feel alive and a tabbed one feels like a
 * form.
 *
 * ── The vertical rail ───────────────────────────────────────────────────────
 *
 * The filter sits in a 20pt column down the left edge with its labels rotated,
 * exactly as the references do it. It looks eccentric and it is the right call:
 * a horizontal segmented control costs a full row of a panel that is already
 * only a third of the screen, and the rail costs nothing but a sliver of width.
 */
export function RoomChatPanel({ chat, events, meId, notice, onNamePress }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [pinned, setPinned] = useState(true);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<FlatList<Row_>>(null);

  const rows = merge(chat, events, filter);

  // Counted, not guessed. The pill has to say how many lines were missed while
  // somebody was reading back, and the only honest source for that is how much
  // the list grew since they stopped following it.
  const seen = useRef(rows.length);
  useEffect(() => {
    const grew = rows.length - seen.current;
    seen.current = rows.length;
    if (grew <= 0) return;
    setUnread((count) => (pinned ? 0 : count + grew));
  }, [rows.length, pinned]);

  // Scrolling up to read must not be undone by the next arrival. The pill
  // appears instead, and tapping it returns to the bottom — which is also how
  // the references handle it ("24 new messages").
  const onScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    const atBottom = event.nativeEvent.contentOffset.y <= 24;
    setPinned(atBottom);
    if (atBottom) setUnread(0);
  }, []);

  function jumpToLatest() {
    haptic.tap();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setPinned(true);
    setUnread(0);
  }

  return (
    <View style={styles.root}>
      <FilterRail value={filter} onChange={setFilter} />

      <View style={styles.body}>
        {/* Pinned, not scrolled away. It is a policy statement and the
            references keep it visible; ours says the same thing in one line
            rather than six. */}
        <View style={styles.notice}>
          <Ionicons name="shield-checkmark" size={11} color={colors.text.onMedia} />
          <Text variant="micro" tone="onMedia" style={styles.noticeText} numberOfLines={2}>
            {notice}
          </Text>
        </View>

        <FlatList
          ref={listRef}
          data={rows}
          // Newest at the bottom, which `inverted` achieves by rendering the
          // newest first and flipping — so offset 0 IS the latest line.
          inverted
          keyExtractor={(row) => (row.type === 'chat' ? row.line.id : row.line.id)}
          renderItem={({ item }) =>
            item.type === 'chat' ? (
              <ChatRow
                line={item.line}
                mine={item.line.userId === meId}
                onNamePress={onNamePress}
              />
            ) : (
              <EventRow line={item.line} />
            )
          }
          onScroll={onScroll}
          scrollEventThrottle={64}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          testID="room-chat-list"
        />

        {!pinned && unread > 0 && (
          <Animated.View entering={FadeInDown.duration(180)} style={styles.unreadWrap}>
            <Pressable
              onPress={jumpToLatest}
              accessibilityRole="button"
              style={styles.unread}
              testID="chat-unread"
            >
              <Text variant="micro" tone="onBrand">
                {t('room.newMessages', { count: unread })}
              </Text>
              <Ionicons name="chevron-down" size={12} color={colors.text.onBrand} />
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

/** The rotated column of filters down the left edge. */
function FilterRail({
  value,
  onChange,
}: {
  value: ChatFilter;
  onChange: (next: ChatFilter) => void;
}) {
  const { t } = useTranslation();
  const options: { key: ChatFilter; label: string }[] = [
    { key: 'all', label: t('room.filterAll') },
    { key: 'room', label: t('room.filterRoom') },
    { key: 'chat', label: t('room.filterChat') },
  ];

  return (
    <View style={styles.rail}>
      {options.map((option) => (
        <Pressable
          key={option.key}
          onPress={() => {
            haptic.selection();
            onChange(option.key);
          }}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === option.key }}
          accessibilityLabel={option.label}
          style={[styles.railTab, value === option.key && styles.railTabActive]}
          testID={`chat-filter-${option.key}`}
        >
          <Text
            variant="micro"
            tone={value === option.key ? 'onBrand' : 'onMedia'}
            style={styles.railLabel}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function ChatRow({
  line,
  mine,
  onNamePress,
}: {
  line: ChatLine;
  mine: boolean;
  onNamePress: (userId: string, name: string | null) => void;
}) {
  const nameColor = line.look?.nameColor ? themed(line.look.nameColor).color : undefined;
  const bubble = line.look?.bubble ? themed(line.look.bubble) : null;

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.line}>
      <Row gap="xs" align="center">
        <Pressable
          onPress={() => onNamePress(line.userId, line.name)}
          accessibilityRole="button"
          hitSlop={spacing.xs}
        >
          <Text
            variant="micro"
            tone={mine ? 'brand' : 'onMedia'}
            numberOfLines={1}
            style={nameColor ? { color: nameColor } : undefined}
          >
            {line.name ?? '—'}
          </Text>
        </Pressable>
      </Row>

      {bubble ? (
        <View
          style={[
            styles.bubble,
            { backgroundColor: bubble.background, borderColor: bubble.border },
          ]}
        >
          <Text variant="caption" style={{ color: bubble.text }}>
            {line.body}
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="onMedia">
          {line.body}
        </Text>
      )}
    </Animated.View>
  );
}

/** An arrival, a gift or a notice — a capsule, as the references draw them. */
function EventRow({ line }: { line: RoomEventLine }) {
  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      style={[styles.event, line.kind === 'gift' && styles.eventGift]}
    >
      <Ionicons
        name={
          line.kind === 'gift'
            ? 'gift'
            : line.kind === 'entry'
              ? 'enter-outline'
              : 'information-circle'
        }
        size={10}
        color={colors.text.onMedia}
      />
      <Text variant="micro" tone="onMedia" numberOfLines={2} style={styles.eventText}>
        {line.text}
      </Text>
    </Animated.View>
  );
}

/**
 * Chat and events, newest first, filtered.
 *
 * Both lists are already ordered; this interleaves them by arrival rather than
 * by timestamp, because an event has no timestamp the chat shares and a room
 * reads correctly as long as nothing jumps backwards.
 */
function merge(chat: ChatLine[], events: RoomEventLine[], filter: ChatFilter): Row_[] {
  const rows: Row_[] = [];
  if (filter !== 'room') rows.push(...chat.map((line) => ({ type: 'chat' as const, line })));
  if (filter !== 'chat') rows.push(...events.map((line) => ({ type: 'event' as const, line })));
  // `inverted` renders index 0 at the bottom, so the newest must come first.
  return rows.reverse();
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  rail: { width: 22, paddingTop: spacing.sm, gap: spacing.xs },
  railTab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: 2,
    borderTopRightRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    backgroundColor: colors.bg.videoScrim,
    alignItems: 'center',
  },
  railTabActive: { backgroundColor: colors.brand.solid },
  // Rotated rather than wrapped: a 22pt column cannot hold a horizontal word.
  railLabel: { fontSize: 9, lineHeight: 11, transform: [{ rotate: '90deg' }], width: 34 },
  body: { flex: 1, minWidth: 0 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.bg.videoScrim,
  },
  noticeText: { flex: 1, fontSize: 9, lineHeight: 12, opacity: 0.8 },
  list: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  line: { gap: 1, marginBottom: spacing.sm },
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: '94%',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.sm,
    borderWidth: 1.5,
  },
  event: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    maxWidth: '96%',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
  eventGift: { backgroundColor: colors.brand.solid },
  eventText: { flexShrink: 1, fontSize: 9, lineHeight: 12 },
  unreadWrap: { position: 'absolute', bottom: spacing.sm, alignSelf: 'center' },
  unread: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.solid,
  },
});
