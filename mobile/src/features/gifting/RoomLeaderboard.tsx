// Who has given the most in this room.
//
// The content of a sheet, polled only while that sheet is open. It is the
// social half of gifting — being seen at the top of a host's board is a large
// part of why people give — so it names people plainly and ranks them without
// decoration: the number IS the status.

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { useRoomLeaderboard } from '@/api/queries/useGifts';
import type { LeaderboardEntry } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatCoins } from '@/lib/money';
import { coins } from '@/lib/units';
import { colors } from '@/theme';
import { Avatar, Banner, Column, EmptyState, Row, Skeleton, Text } from '@/ui';

interface Props {
  roomId: string;
  open: boolean;
  meId: string | undefined;
}

/**
 * Rows shown. The API returns twenty; ten is what fits in a sheet on a small
 * phone without scrolling inside a draggable surface, which fights the drag.
 */
const SHOWN = 10;

/** The podium: a trophy instead of a number. */
const PODIUM = 3;

export function RoomLeaderboard({ roomId, open, meId }: Props) {
  const { t } = useTranslation();
  const board = useRoomLeaderboard(roomId, open);

  if (board.isError) {
    return <Banner message={errorMessage(board.error)} onRetry={() => void board.refetch()} />;
  }

  if (board.isLoading || board.data === undefined) {
    return (
      <Column gap="md">
        {Array.from({ length: 4 }, (_, index) => (
          <Row key={index} gap="md">
            <Skeleton width={32} height={32} rounding="pill" />
            <Skeleton width={140} height={14} />
          </Row>
        ))}
      </Column>
    );
  }

  if (board.data.length === 0) {
    return (
      <EmptyState
        icon="trophy-outline"
        title={t('gifting.boardEmptyTitle')}
        body={t('gifting.boardEmptyBody')}
      />
    );
  }

  return (
    <Column gap="md">
      {board.data.slice(0, SHOWN).map((entry) => (
        <BoardRow key={entry.userId} entry={entry} mine={entry.userId === meId} />
      ))}
    </Column>
  );
}

function BoardRow({ entry, mine }: { entry: LeaderboardEntry; mine: boolean }) {
  const { t } = useTranslation();
  const name = entry.displayName ?? '—';

  return (
    <Row
      gap="md"
      accessible
      accessibilityLabel={t('gifting.boardRow', {
        rank: entry.rank,
        name,
        coins: formatCoins(coins(entry.coins)),
      })}
    >
      <View style={styles.rank}>
        {entry.rank <= PODIUM ? (
          // Brand, not the gift-tier colours — those are reserved for tiers,
          // and a gold trophy would read as a Tier 5 gift.
          <Ionicons name="trophy" size={18} color={colors.brand.accent} />
        ) : (
          <Text variant="caption" tone="faint">
            {entry.rank}
          </Text>
        )}
      </View>
      <Avatar uri={entry.avatarUrl} name={name} size="sm" />
      <Text variant="body" tone={mine ? 'brand' : 'primary'} numberOfLines={1} style={styles.name}>
        {name}
      </Text>
      <Row gap="xs">
        <Ionicons name="ellipse" size={10} color={colors.currency.coin} />
        <Text variant="bodyStrong" style={styles.coins}>
          {formatCoins(coins(entry.coins))}
        </Text>
      </Row>
    </Row>
  );
}

const styles = StyleSheet.create({
  rank: { width: 24, alignItems: 'center' },
  name: { flex: 1 },
  coins: { color: colors.currency.coin },
});
