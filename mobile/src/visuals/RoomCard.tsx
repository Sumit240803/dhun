import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatCompact } from '@/lib/money';
import type { FeedRoom } from '@/api/types';
import { absoluteFill, colors, radius, spacing } from '@/theme';
import { Text } from '@/ui/Text';

export interface RoomCardProps {
  room: FeedRoom;
  onPress: () => void;
  /** Already-translated category label, e.g. "Singing". */
  tagLabel: string;
  testID?: string;
}

/**
 * One room in the feed. The single most important component in the app.
 *
 * Everything on it answers one of two questions a browsing user asks in about
 * half a second: *what is happening in there* (the cover, the tag) and *is
 * anyone else in there* (the viewer count, the seat avatars). Anything that
 * answers neither is decoration and does not belong.
 *
 * The gradient foot is not styling — white text over an arbitrary photograph is
 * unreadable perhaps one time in five, and that one time is a host whose room
 * nobody opens.
 */
export function RoomCard({ room, onPress, tagLabel, testID }: RoomCardProps) {
  const isParty = room.seatCount !== null;

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${room.hostName}. ${tagLabel}. ${formatCompact(room.viewers)} watching`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {room.coverUrl === null ? (
        // Placeholder until there are photographs the company has rights to.
        // Tinted rather than grey so a full grid of them reads as a deliberate
        // pattern rather than as a failed load.
        <View style={[styles.cover, styles.placeholder]}>
          <Ionicons name={isParty ? 'people' : 'videocam'} size={28} color={colors.text.faint} />
        </View>
      ) : (
        <Image
          source={{ uri: room.coverUrl }}
          style={styles.cover}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={180}
        />
      )}

      <View style={styles.topRow}>
        {room.trending && (
          <View style={styles.trending}>
            <Ionicons name="flame" size={11} color={colors.text.onMedia} />
            <Text variant="micro" tone="onMedia">
              TOP
            </Text>
          </View>
        )}
        <View style={styles.tag}>
          <Text variant="micro" tone="onMedia" numberOfLines={1}>
            {tagLabel}
          </Text>
        </View>
      </View>

      <LinearGradient
        colors={[colors.bg.baseTransparent, colors.bg.videoScrim]}
        style={styles.foot}
        pointerEvents="none"
      />

      <View style={styles.footContent}>
        {isParty && (
          <View style={styles.seats}>
            {/*
              Seat dots stand in for the occupants' avatars. Party rooms live or
              die on looking OCCUPIED — an empty-looking seat grid is the single
              strongest reason someone scrolls past.
            */}
            {Array.from({ length: Math.min(3, room.seatCount ?? 0) }, (_, index) => (
              <View key={index} style={[styles.seat, { marginLeft: index === 0 ? 0 : -8 }]} />
            ))}
            <View style={[styles.seat, styles.seatCount, { marginLeft: -8 }]}>
              <Text variant="micro" tone="onMedia">
                {room.seatCount}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.nameRow}>
          <Text variant="caption" tone="onMedia" numberOfLines={1} style={styles.name}>
            {room.hostName}
          </Text>
          <Text variant="caption" tone="onMedia">
            {flagFor(room.country)}
          </Text>
        </View>

        <View style={styles.viewers}>
          <Ionicons name="cellular" size={11} color={colors.text.onMedia} />
          <Text variant="micro" tone="onMedia">
            {formatCompact(room.viewers)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * ISO 3166-1 alpha-2 to its flag emoji.
 *
 * Arithmetic rather than a lookup table: the regional indicator block is laid
 * out in alphabetical order, so every country works and none has to be added.
 */
function flagFor(countryCode: string): string {
  const REGIONAL_INDICATOR_A = 0x1f1e6;
  const LETTER_A = 'A'.charCodeAt(0);

  return countryCode
    .toUpperCase()
    .split('')
    .map((letter) => String.fromCodePoint(REGIONAL_INDICATOR_A + letter.charCodeAt(0) - LETTER_A))
    .join('');
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    aspectRatio: 0.82,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.bg.raised,
  },
  pressed: { opacity: 0.9 },
  cover: { ...absoluteFill },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
  },
  topRow: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.glass.scrim,
  },
  trending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.status.live,
  },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  footContent: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    gap: spacing.xs,
  },
  seats: { flexDirection: 'row', alignItems: 'center' },
  seat: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.text.onMedia,
    backgroundColor: colors.bg.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatCount: { backgroundColor: colors.glass.scrim },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { flexShrink: 1 },
  viewers: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
