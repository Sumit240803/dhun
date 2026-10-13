import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { LeaderboardEntry } from '@/api/types';
import { useTranslation } from '@/i18n';
import { formatCompact } from '@/lib/money';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Avatar, Row, Text } from '@/ui';

interface Props {
  hostId: string;
  hostName: string | null;
  hostAvatar: string | null;
  /** Coins this host has been gifted in the room so far. */
  hostCoins: number | undefined;
  viewers: number;
  showViewers: boolean;
  following: boolean;
  followPending: boolean;
  /** Top gifters, best first. The rail shows three. */
  contributors: LeaderboardEntry[];
  onFollow: () => void;
  onHostPress: () => void;
  onContributorsPress: () => void;
  onClose: () => void;
}

/** Faces in the contributor rail. Three fits beside a viewer count on a small phone. */
const RAIL = 3;

/**
 * The top line of a room: who is hosting, who is winning, and the way out.
 *
 * ── Why the contributor rail is here and not in a sheet ─────────────────────
 *
 * It is the status display that drives gifting. Being one of the three faces at
 * the top of a host's room is a public position people pay to hold and pay
 * again to keep, and a leaderboard hidden behind a tap is a leaderboard nobody
 * is competing on. The sheet still exists — tapping the rail opens it — but the
 * top three are always visible.
 *
 * Drawn with NO background of its own. The room's backdrop scrim already
 * darkens the top of the screen, and a second panel over it would make the
 * header an opaque bar and lose the picture.
 */
export function RoomHeader({
  hostName,
  hostAvatar,
  hostCoins,
  viewers,
  showViewers,
  following,
  followPending,
  contributors,
  onFollow,
  onHostPress,
  onContributorsPress,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const name = hostName ?? '—';

  return (
    <Row gap="sm" align="center">
      <Pressable
        onPress={onHostPress}
        accessibilityRole="button"
        accessibilityLabel={name}
        style={styles.host}
        testID="room-host"
      >
        <Avatar name={name} uri={hostAvatar} size={32} />
        <View style={styles.hostMeta}>
          <Text variant="micro" tone="onMedia" numberOfLines={1} style={styles.hostName}>
            {name}
          </Text>
          {hostCoins !== undefined && hostCoins > 0 && (
            <Row gap="xs" align="center">
              <Ionicons name="gift" size={8} color={colors.brand.accent} />
              <Text variant="micro" tone="onMedia" style={styles.hostCoins}>
                {formatCompact(hostCoins)}
              </Text>
            </Row>
          )}
        </View>
      </Pressable>

      {/* Hidden once following — a button whose only outcome is "already done"
          is a button taking up space in the tightest row on the screen. */}
      {!following && (
        <Pressable
          onPress={() => {
            haptic.tap();
            onFollow();
          }}
          disabled={followPending}
          accessibilityRole="button"
          accessibilityLabel={t('room.follow')}
          style={({ pressed }) => [styles.follow, pressed && styles.followPressed]}
          testID="room-follow"
        >
          <Ionicons name="add" size={16} color={colors.text.onBrand} />
        </Pressable>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
        style={styles.railScroll}
      >
        <Pressable
          onPress={onContributorsPress}
          accessibilityRole="button"
          accessibilityLabel={t('gifting.boardTitle')}
          style={styles.railInner}
          testID="room-contributors"
        >
          {contributors.slice(0, RAIL).map((entry, index) => (
            <View key={entry.userId} style={[styles.railFace, index > 0 && styles.railOverlap]}>
              <Avatar name={entry.displayName ?? '—'} uri={entry.avatarUrl} size={24} />
            </View>
          ))}
          {contributors.length === 0 && (
            <View style={styles.railEmpty}>
              <Ionicons name="trophy-outline" size={12} color={colors.text.onMedia} />
            </View>
          )}
        </Pressable>
      </ScrollView>

      {showViewers && (
        <Text variant="micro" tone="onMedia" style={styles.viewers}>
          {formatCompact(viewers)}
        </Text>
      )}

      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('room.leave')}
        hitSlop={spacing.md}
        testID="room-close"
      >
        <Ionicons name="close" size={22} color={colors.text.onMedia} />
      </Pressable>
    </Row>
  );
}

const styles = StyleSheet.create({
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 124,
    padding: 2,
    paddingRight: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
  hostMeta: { flexShrink: 1, minWidth: 0 },
  hostName: { fontSize: 10, lineHeight: 13 },
  hostCoins: { fontSize: 9, lineHeight: 12, opacity: 0.8 },
  follow: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.solid,
  },
  followPressed: { backgroundColor: colors.brand.pressed },
  railScroll: { flex: 1 },
  rail: { alignItems: 'center' },
  railInner: { flexDirection: 'row', alignItems: 'center' },
  railFace: { borderRadius: radius.pill },
  // Overlapped, as the references draw them. A rank order shown as a stack
  // reads faster than three separate circles and costs half the width.
  railOverlap: { marginLeft: -8 },
  railEmpty: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.onMediaWell,
  },
  viewers: { fontVariant: ['tabular-nums'] },
});
