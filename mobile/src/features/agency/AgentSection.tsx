import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import {
  useAnswerRequest,
  useDecideQuit,
  useInventory,
  useInviteHost,
  useJoinRequests,
  useQuitRequests,
} from '@/api/queries/useAgency';
import type { AgentSeat } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage, fieldError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins } from '@/lib/money';
import { coins as asCoins } from '@/lib/units';
import { colors, radius, spacing } from '@/theme';
import { Banner, Button, Card, Column, Divider, Input, ListItem, Row, Skeleton, Text } from '@/ui';

import { formatDay, personName } from './format';

/** The caller's seat: the Agent ID hosts type, and whom they have asked to join. */
export function AgentSeatCard({ seat }: { seat: AgentSeat }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(String(seat.publicId));
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Animated.View entering={FadeInDown.duration(220)}>
      <Card>
        <Column gap="md">
          <Column gap="xs">
            <Text variant="micro" tone="faint">
              {t('agency.agentTitle')}
            </Text>
            <Text variant="title" numberOfLines={1}>
              {seat.agency.name}
            </Text>
          </Column>
          <Row justify="between" style={styles.idBox}>
            <Column gap="xs">
              <Text variant="heading" selectable testID="my-agent-id">
                {t('agency.agentIdShare', { id: seat.publicId })}
              </Text>
              <Text variant="caption" tone="secondary">
                {t('agency.agentIdHelp')}
              </Text>
            </Column>
            <Button
              label={copied ? t('agency.copied') : t('agency.copy')}
              onPress={() => void copy()}
              variant="ghost"
              size="sm"
            />
          </Row>
        </Column>
      </Card>
    </Animated.View>
  );
}

/**
 * The way through to coin trading.
 *
 * Shown to every owner, including one without the grant: the screen behind it
 * explains why there is nothing there, which beats hiding the feature and
 * leaving them to wonder whether we have it at all.
 */
export function CoinStockCard() {
  const { t } = useTranslation();
  const inventory = useInventory(true);
  const enabled = inventory.data !== undefined;

  return (
    <Card padded={false}>
      <ListItem
        title={t('agencyCoins.inventoryTitle')}
        subtitle={
          enabled
            ? formatCoins(asCoins(inventory.data.coins))
            : inventory.isError
              ? t('agencyCoins.notTradingTitle')
              : undefined
        }
        left={<Ionicons name="server-outline" size={20} color={colors.currency.coin} />}
        right={<Ionicons name="chevron-forward" size={18} color={colors.text.faint} />}
        onPress={() => {
          haptic.selection();
          router.push('/(app)/agency/coins');
        }}
        testID="coin-stock-row"
      />
    </Card>
  );
}

/** Applications from hosts who typed this Agent ID. */
export function JoinApplications() {
  const { t } = useTranslation();
  const requests = useJoinRequests();
  const answer = useAnswerRequest();
  const applications = requests.data?.asAgent.filter((r) => r.direction === 'host_applied') ?? [];

  return (
    <Card>
      <Column gap="md">
        <Text variant="heading">{t('agency.applicationsTitle')}</Text>
        {requests.isError ? (
          <Banner message={errorMessage(requests.error)} onRetry={() => void requests.refetch()} />
        ) : requests.data === undefined ? (
          <Skeleton height={48} rounding="md" />
        ) : applications.length === 0 ? (
          <Text variant="caption" tone="secondary">
            {t('agency.applicationsEmpty')}
          </Text>
        ) : (
          applications.map((r, i) => (
            <Column key={r.id} gap="sm">
              {i > 0 && <Divider />}
              <Text variant="bodyStrong">
                {t('agency.hostLine', { name: personName(r.host), id: r.host.publicId })}
              </Text>
              {r.message !== null && (
                <Text variant="caption" tone="secondary">
                  {r.message}
                </Text>
              )}
              <Row gap="sm">
                <Button
                  label={t('agency.accept')}
                  onPress={() => {
                    haptic.tap();
                    answer.mutate(
                      { id: r.id, accept: true },
                      { onSuccess: () => haptic.success(), onError: () => haptic.error() },
                    );
                  }}
                  size="sm"
                />
                <Button
                  label={t('agency.decline')}
                  onPress={() => {
                    haptic.selection();
                    answer.mutate({ id: r.id, accept: false });
                  }}
                  variant="secondary"
                  size="sm"
                />
              </Row>
            </Column>
          ))
        )}
        {answer.error != null && <Banner message={errorMessage(answer.error)} />}
      </Column>
    </Card>
  );
}

/** Route 2: User ID + Host Code. */
export function InviteHostCard() {
  const { t } = useTranslation();
  const invite = useInviteHost();
  const [userId, setUserId] = useState('');
  const [code, setCode] = useState('');

  const userIdError = fieldError(invite.error, 'userId');
  const codeError = fieldError(invite.error, 'hostCode');
  const general =
    invite.error != null && userIdError === undefined && codeError === undefined
      ? errorMessage(invite.error)
      : undefined;

  return (
    <Card>
      <Column gap="md">
        <Column gap="xs">
          <Text variant="heading">{t('agency.inviteTitle')}</Text>
          <Text variant="caption" tone="secondary">
            {t('agency.inviteBody')}
          </Text>
        </Column>
        <Input
          label={t('agency.userIdLabel')}
          value={userId}
          onChangeText={(next) => setUserId(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          maxLength={8}
          error={userIdError}
          testID="invite-user-id"
        />
        <Input
          label={t('agency.hostCodeLabel')}
          value={code}
          onChangeText={(next) => setCode(next.replace(/[^a-zA-Z2-9]/g, '').toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          error={codeError}
          testID="invite-host-code"
        />
        {invite.isSuccess && <Banner tone="info" message={t('agency.inviteSent')} />}
        {general !== undefined && <Banner message={general} />}
        <Button
          label={t('agency.sendInvite')}
          onPress={() => {
            haptic.tap();
            invite.mutate(
              { userId: Number(userId), hostCode: code },
              {
                onSuccess: () => {
                  haptic.success();
                  setUserId('');
                  setCode('');
                },
                onError: () => haptic.error(),
              },
            );
          }}
          disabled={userId.length < 8 || code.length !== 6}
          loading={invite.isPending}
          variant="secondary"
          fullWidth
          testID="send-invite"
        />
      </Column>
    </Card>
  );
}

/** Owner only: hosts asking to leave. Pending ones, and rejections still approvable. */
export function QuitApplications() {
  const { t, locale } = useTranslation();
  const requests = useQuitRequests(true);
  const decide = useDecideQuit();

  return (
    <Card>
      <Column gap="md">
        <Text variant="heading">{t('agency.leavingTitle')}</Text>
        {requests.isError ? (
          <Banner message={errorMessage(requests.error)} onRetry={() => void requests.refetch()} />
        ) : requests.data === undefined ? (
          <Skeleton height={48} rounding="md" />
        ) : requests.data.length === 0 ? (
          <Text variant="caption" tone="secondary">
            {t('agency.leavingEmpty')}
          </Text>
        ) : (
          requests.data.map((q, i) => (
            <Column key={q.id} gap="sm">
              {i > 0 && <Divider />}
              <Text variant="bodyStrong">
                {t('agency.hostLine', { name: personName(q.host), id: q.host.publicId })}
              </Text>
              <Text variant="caption" tone="secondary">
                “{q.reason}”
              </Text>
              <Text variant="micro" tone="faint">
                {q.status === 'pending' && q.autoLeaveAt !== null
                  ? t('agency.leavesOn', { date: formatDay(q.autoLeaveAt, locale) })
                  : q.approvableUntil !== null
                    ? t('agency.declinedCanApprove', { date: formatDay(q.approvableUntil, locale) })
                    : ''}
              </Text>
              <Row gap="sm">
                <Button
                  label={t('agency.approve')}
                  onPress={() => {
                    haptic.tap();
                    decide.mutate(
                      { id: q.id, approve: true },
                      { onSuccess: () => haptic.success(), onError: () => haptic.error() },
                    );
                  }}
                  size="sm"
                />
                {q.status === 'pending' && (
                  <Button
                    label={t('agency.reject')}
                    onPress={() => {
                      haptic.selection();
                      decide.mutate({ id: q.id, approve: false });
                    }}
                    variant="secondary"
                    size="sm"
                  />
                )}
              </Row>
            </Column>
          ))
        )}
        {decide.error != null && <Banner message={errorMessage(decide.error)} />}
      </Column>
    </Card>
  );
}

const styles = StyleSheet.create({
  idBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand.soft,
  },
});
