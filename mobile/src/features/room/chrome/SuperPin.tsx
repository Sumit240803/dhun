import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import type { SuperView } from '@/api/types';
import { formatGems } from '@/lib/money';
import { gems } from '@/lib/units';
import { colors, radius, spacing } from '@/theme';
import { Avatar, Row, Text } from '@/ui';
import { themed } from '@/visuals/look';

interface Props {
  message: SuperView;
  onExpire: () => void;
}

/**
 * A paid line, pinned over the chat for the seconds the server names.
 *
 * Measured from `at`, not from arrival: a viewer who joins twenty seconds in
 * sees it for the ten that remain, the same as everyone else.
 */
export function SuperPin({ message, onExpire }: Props) {
  useEffect(() => {
    const remaining = new Date(message.at).getTime() + message.pinSeconds * 1_000 - Date.now();
    if (remaining <= 0) {
      onExpire();
      return;
    }
    const timer = setTimeout(onExpire, remaining);
    return () => clearTimeout(timer);
  }, [message.id, message.at, message.pinSeconds, onExpire]);

  const nameColor = message.look.nameColor ? themed(message.look.nameColor).color : undefined;

  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOut.duration(200)}
      style={styles.pin}
      testID="super-pin"
    >
      <Avatar name={message.name ?? '—'} uri={message.avatarUrl} size="sm" />
      <View style={styles.body}>
        <Row gap="xs" align="center">
          <Ionicons name="megaphone" size={11} color={colors.text.onBrand} />
          <Text
            variant="micro"
            tone="onBrand"
            numberOfLines={1}
            style={nameColor ? { color: nameColor } : undefined}
          >
            {message.name ?? '—'}
          </Text>
          <Text variant="micro" tone="onBrand" style={styles.gems}>
            {formatGems(gems(message.gems))}
          </Text>
        </Row>
        <Text variant="caption" tone="onBrand" numberOfLines={3}>
          {message.body}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pin: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.currency.gem,
  },
  body: { flex: 1, gap: 2 },
  gems: { opacity: 0.85 },
});
