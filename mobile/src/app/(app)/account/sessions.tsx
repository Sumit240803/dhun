import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { authApi } from '@/api/endpoints/auth';
import { queryKeys } from '@/api/queries/keys';
import type { ActiveSession } from '@/api/types';
import { getDeviceId } from '@/features/auth/device';
import { useTranslation } from '@/i18n';
import { errorMessage, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import {
  Banner,
  Button,
  Card,
  Column,
  Divider,
  EmptyState,
  Row,
  Screen,
  Skeleton,
  Text,
} from '@/ui';

type IconName = keyof typeof Ionicons.glyphMap;

const platformIcons: Record<string, IconName> = {
  android: 'logo-android',
  ios: 'logo-apple',
  web: 'globe-outline',
};

/**
 * Where the account is signed in, and how to end any of it.
 *
 * The other half of the story the refresh-token replay detection tells:
 * detecting a stolen token is worth little if the owner cannot see that a phone
 * they lost is still signed in, or do anything about it.
 */
export default function SessionsScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    void getDeviceId().then(setDeviceId);
  }, []);

  const sessions = useQuery({
    queryKey: queryKeys.devices.sessions(),
    // Held until the device id is known, so the server can mark which row is
    // this phone. Listing without it would offer to sign the user out of the
    // device they are holding.
    enabled: deviceId !== null,
    queryFn: async () => (await authApi.listSessions(deviceId!)).sessions,
  });

  const revoke = useMutation({
    mutationFn: (target: string) => authApi.revokeSession(target),
    onSuccess: () => {
      haptic.success();
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.sessions() });
    },
    onError: () => haptic.error(),
  });

  const rows = sessions.data ?? [];
  const others = rows.filter((row) => !row.current);

  return (
    <Screen padded={false} edges={['top']}>
      <Row style={styles.header} gap="md">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={spacing.md}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
        </Pressable>
        <View style={styles.titles}>
          <Text variant="heading">{t('account.sessionsTitle')}</Text>
          <Text variant="caption" tone="secondary">
            {t('account.sessionsIntro')}
          </Text>
        </View>
      </Row>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={sessions.isRefetching}
            onRefresh={() => void sessions.refetch()}
            tintColor={colors.brand.solid}
            colors={[colors.brand.solid]}
          />
        }
      >
        {sessions.isLoading && (
          <Card>
            <Column gap="lg">
              <Skeleton width="70%" height={20} />
              <Skeleton width="45%" height={20} />
            </Column>
          </Card>
        )}

        {sessions.error != null && (
          <Banner
            message={errorMessage(sessions.error)}
            detail={traceReference(sessions.error)}
            onRetry={() => void sessions.refetch()}
          />
        )}

        {revoke.error != null && (
          <Banner message={errorMessage(revoke.error)} detail={traceReference(revoke.error)} />
        )}

        {sessions.isSuccess && (
          <Animated.View entering={FadeInDown.duration(260)}>
            <Card padded={false}>
              {rows.map((session, index) => (
                <View key={session.deviceId}>
                  {index > 0 && <Divider />}
                  <SessionRow
                    session={session}
                    signOutLabel={t('account.signOutDevice')}
                    thisDeviceLabel={t('account.thisDevice')}
                    lastUsed={relativeLabel(session.lastSeenAt, t)}
                    busy={revoke.isPending && revoke.variables === session.deviceId}
                    onRevoke={() => {
                      haptic.tap();
                      revoke.mutate(session.deviceId);
                    }}
                  />
                </View>
              ))}
            </Card>
          </Animated.View>
        )}

        {sessions.isSuccess && others.length === 0 && (
          <Animated.View entering={FadeIn.duration(220)}>
            <EmptyState
              icon="shield-checkmark-outline"
              title={t('account.sessionsEmpty')}
              body={t('account.sessionsEmptyBody')}
            />
          </Animated.View>
        )}
      </ScrollView>
    </Screen>
  );
}

function SessionRow({
  session,
  signOutLabel,
  thisDeviceLabel,
  lastUsed,
  busy,
  onRevoke,
}: {
  session: ActiveSession;
  signOutLabel: string;
  thisDeviceLabel: string;
  lastUsed: string;
  busy: boolean;
  onRevoke: () => void;
}) {
  return (
    <Row style={styles.row} gap="md">
      <View style={styles.icon}>
        <Ionicons
          name={platformIcons[session.platform] ?? 'hardware-chip-outline'}
          size={20}
          color={session.current ? colors.brand.accent : colors.text.secondary}
        />
      </View>

      <Column gap="xs" flex={1}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {session.current ? thisDeviceLabel : session.platform}
        </Text>
        <Text variant="micro" tone="faint">
          {session.appVersion !== null ? `${session.appVersion} · ${lastUsed}` : lastUsed}
        </Text>
      </Column>

      {/* This device never offers to sign itself out — that is what the Me
          screen's sign-out is for, and it clears local storage too. */}
      {!session.current && (
        <Button
          label={signOutLabel}
          onPress={onRevoke}
          loading={busy}
          variant="ghost"
          size="sm"
          testID={`revoke-${session.deviceId}`}
        />
      )}
    </Row>
  );
}

/**
 * "Active now", "6h ago", "3d ago".
 *
 * Hours and days only. Minutes would need pluralisation in two languages to
 * say something a user reads as "just now" anyway.
 */
function relativeLabel(iso: string, t: ReturnType<typeof useTranslation>['t']): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(elapsed / 3_600_000);

  if (hours < 1) return t('account.lastUsedNow');
  if (hours < 24) return t('account.lastUsedHours', { count: hours });
  return t('account.lastUsedDays', { count: Math.floor(hours / 24) });
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  titles: { flex: 1, gap: 2 },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
