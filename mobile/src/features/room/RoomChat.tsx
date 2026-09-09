// The chat half of a room.
//
// Extracted from the room screen because that screen already carries the media
// connection, the socket, the seat map and the host controls — and a chat log
// with a composer is a self-contained thing with its own scroll behaviour.

import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { ChatLine } from '@/features/room/gateway';
import { useTranslation } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { EmptyState, Input, Row, Text } from '@/ui';

interface Props {
  lines: ChatLine[];
  /** Own messages are tinted, so a user can find themselves in a fast room. */
  meId: string | undefined;
  /** False while reconnecting — the composer says so rather than failing silently. */
  canSend: boolean;
  onSend: (body: string) => boolean;
}

export function RoomChat({ lines, meId, canSend, onSend }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlashListRef<ChatLine>>(null);

  // Follow the tail. In a busy room the newest line is the only one anyone is
  // reading, and a log that does not follow it is a log nobody watches.
  useEffect(() => {
    if (lines.length === 0) return;
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [lines.length]);

  function send() {
    const body = draft.trim();
    if (body === '' || !canSend) return;

    // Cleared optimistically. The server echoes the line back within
    // milliseconds, and holding the draft until it arrives makes the composer
    // feel broken on a slow connection.
    if (onSend(body)) {
      haptic.tap();
      setDraft('');
    }
  }

  return (
    <View style={styles.container}>
      {lines.length === 0 ? (
        <EmptyState icon="chatbubble-outline" title={t('room.chatEmpty')} body="" />
      ) : (
        <FlashList
          ref={listRef}
          data={lines}
          keyExtractor={(line) => line.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <Line line={item} mine={item.userId === meId} />}
        />
      )}

      {!canSend && (
        <Animated.View entering={FadeIn.duration(160)} style={styles.offline}>
          <Text variant="micro" tone="faint">
            {t('room.chatOffline')}
          </Text>
        </Animated.View>
      )}

      <Row gap="sm" style={styles.composer}>
        <View style={styles.field}>
          <Input
            placeholder={t('room.chatPlaceholder')}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={send}
            maxLength={500}
            returnKeyType="send"
            editable={canSend}
          />
        </View>
        <Pressable
          onPress={send}
          accessibilityRole="button"
          accessibilityLabel={t('room.chatSend')}
          disabled={draft.trim() === '' || !canSend}
          style={[styles.sendButton, (draft.trim() === '' || !canSend) && styles.sendDisabled]}
        >
          <Ionicons name="send" size={18} color={colors.text.onBrand} />
        </Pressable>
      </Row>
    </View>
  );
}

function Line({ line, mine }: { line: ChatLine; mine: boolean }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.line}>
      <Text variant="micro" tone={mine ? 'brand' : 'faint'} numberOfLines={1}>
        {line.name ?? '—'}
      </Text>
      <Text variant="caption">{line.body}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  line: { gap: 2, marginBottom: spacing.md },
  offline: { alignItems: 'center', paddingBottom: spacing.xs },
  composer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  field: { flex: 1 },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: colors.bg.raised },
});
