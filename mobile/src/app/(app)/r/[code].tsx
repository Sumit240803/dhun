import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/client';
import { liveRoomsApi } from '@/api/endpoints/rooms';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme';
import { Banner, EmptyState, Screen, Text } from '@/ui';

/**
 * A shared link: dhun://r/123456, or https://dhun.live/r/123456.
 *
 * Carries the ROOM CODE, not the uuid — the same number a host reads out on
 * stream — so a link outlives the room it was made for and says so when the
 * room has ended, rather than opening a dead uuid.
 */
export default function SharedRoomRoute() {
  const { t } = useTranslation();
  const { code } = useLocalSearchParams<{ code: string }>();
  const number = /^\d{6,8}$/.test(code ?? '') ? Number(code) : null;

  const lookup = useQuery({
    queryKey: ['rooms', 'byCode', number],
    queryFn: () => liveRoomsApi.byCode(number!),
    enabled: number !== null,
    retry: false,
  });

  useEffect(() => {
    if (lookup.data) {
      router.replace({ pathname: '/(app)/room/[id]', params: { id: lookup.data.room.id } });
    }
  }, [lookup.data]);

  const ended =
    number === null || (lookup.error instanceof ApiError && lookup.error.status === 404);

  return (
    <Screen padded>
      {ended ? (
        <View style={styles.centre}>
          <EmptyState
            icon="radio-outline"
            title={t('room.codeEndedTitle')}
            body={t('room.codeEndedBody')}
            actionLabel={t('common.back')}
            onAction={() => (router.canGoBack() ? router.back() : router.replace('/(app)/(tabs)'))}
            testID="shared-room-ended"
          />
        </View>
      ) : lookup.isError ? (
        <Banner message={errorMessage(lookup.error)} onRetry={() => void lookup.refetch()} />
      ) : (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.brand.accent} />
          <Text variant="caption" tone="secondary" style={styles.wait}>
            {t('room.codeResolving')}
          </Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  wait: { marginTop: spacing.sm },
});
