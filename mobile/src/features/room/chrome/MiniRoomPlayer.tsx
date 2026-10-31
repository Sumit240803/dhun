// The floating player for a minimised room.
//
// Sits above the tab bar on every screen but the room's own. Audio is already
// playing (features/room/liveSession.ts keeps the connection); this is the
// way back in and the way out. Static LIVE badge, no pulsing — the rule is
// motion only where it explains a change, and nothing is changing here.

import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTranslation } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Avatar, Text } from '@/ui';
import { liveSession } from '@/features/room/liveSession';
import { minimisedRoom, useMinimisedRoom } from '@/features/room/minimisedRoom';

/** Clears the tab bar. Tabs are 56 tall plus the home indicator. */
const TAB_BAR = 56;

export function MiniRoomPlayer() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const room = useMinimisedRoom();
  const pathname = usePathname();

  // Inside a room there is nothing to float: the screen is the room.
  if (room === null || pathname.startsWith('/room/')) return null;

  const open = () => {
    haptic.selection();
    router.push({ pathname: '/(app)/room/[id]', params: { id: room.roomId } });
  };

  const leave = () => {
    haptic.tap();
    minimisedRoom.clear();
    void liveSession.disconnectParked();
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOutDown.duration(160)}
      style={[styles.wrap, { bottom: TAB_BAR + insets.bottom + spacing.sm }]}
      pointerEvents="box-none"
    >
      <View style={styles.pill} testID="mini-room">
        <Pressable
          onPress={open}
          style={styles.body}
          accessibilityRole="button"
          accessibilityLabel={t('room.miniReturn')}
          testID="mini-room-open"
        >
          <Avatar name={room.hostName ?? '—'} uri={room.coverUrl} size={36} />
          <View style={styles.text}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {room.title}
            </Text>
            <View style={styles.line}>
              <View style={styles.live}>
                <Text variant="micro" tone="onMedia">
                  LIVE
                </Text>
              </View>
              <Text variant="micro" tone="secondary" numberOfLines={1} style={styles.host}>
                {room.hostName ?? '—'}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-up" size={18} color={colors.text.faint} />
        </Pressable>
        <Pressable
          onPress={leave}
          hitSlop={spacing.sm}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel={t('room.miniLeave')}
          testID="mini-room-leave"
        >
          <Ionicons name="close" size={18} color={colors.text.secondary} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.bg.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
    shadowColor: colors.text.primary,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
  },
  text: { flex: 1, minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  live: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.status.live,
  },
  host: { flexShrink: 1 },
  close: { padding: spacing.md },
});
