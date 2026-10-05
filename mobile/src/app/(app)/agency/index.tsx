import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useProfileSummary } from '@/api/queries/useFeed';
import { useMyAgency } from '@/api/queries/useAgency';
import {
  AgentSeatCard,
  CoinStockCard,
  InviteHostCard,
  JoinApplications,
  QuitApplications,
} from '@/features/agency/AgentSection';
import {
  HostCodeCard,
  HostRequests,
  JoinCard,
  MembershipCard,
  ReceivedCoinsCard,
} from '@/features/agency/HostSection';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { useIsRegistered } from '@/store/session';
import { colors, spacing } from '@/theme';
import { Banner, Column, EmptyState, Row, Screen, Skeleton, Text } from '@/ui';

/**
 * My Agency.
 *
 * One screen for both sides of the relationship, because one person can be
 * both: a host sees their agency (or how to join one) and the way out; an
 * agent sees their Agent ID and who wants in; the owner also sees who wants
 * out. Sections appear only for the roles the caller actually holds.
 */
export default function AgencyScreen() {
  const { t } = useTranslation();
  const isRegistered = useIsRegistered();
  const agency = useMyAgency(isRegistered);
  const summary = useProfileSummary();

  return (
    <Screen padded={false} edges={['top', 'bottom']}>
      <Row style={styles.header} gap="md">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={spacing.md}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
        </Pressable>
        <Text variant="heading">{t('agency.title')}</Text>
      </Row>

      {!isRegistered ? (
        <View style={styles.centre}>
          <EmptyState
            icon="people-outline"
            title={t('agency.guestTitle')}
            body={t('agency.guestBody')}
            actionLabel={t('room.guestAction')}
            onAction={() => {
              haptic.tap();
              router.push('/(auth)');
            }}
          />
        </View>
      ) : agency.isError ? (
        <View style={styles.gutter}>
          <Banner message={errorMessage(agency.error)} onRetry={() => void agency.refetch()} />
        </View>
      ) : agency.data === undefined ? (
        <Column gap="lg" style={styles.gutter}>
          <Skeleton height={180} rounding="lg" />
          <Skeleton height={140} rounding="lg" />
        </Column>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {agency.data.seat !== null && (
            <>
              <AgentSeatCard seat={agency.data.seat} />
              {agency.data.seat.isOwner && <CoinStockCard />}
              <JoinApplications />
              <InviteHostCard />
              {agency.data.seat.isOwner && <QuitApplications />}
            </>
          )}

          <ReceivedCoinsCard />

          {agency.data.membership !== null ? (
            <MembershipCard
              membership={agency.data.membership}
              quitRequest={agency.data.quitRequest}
            />
          ) : (
            // An agent does not also join an agency as a host of someone else.
            agency.data.seat === null && (
              <>
                <HostRequests />
                <JoinCard />
                <HostCodeCard userPublicId={summary.data?.publicId} />
              </>
            )
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { height: 52, paddingHorizontal: spacing.lg },
  gutter: { paddingHorizontal: spacing.lg },
  centre: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
});
