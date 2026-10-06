import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import {
  useAgents,
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
import { Banner, Button, Card, Column, Divider, Input, Row, Skeleton, Text } from '@/ui';

import { formatDay } from './format';
import { CardTitle, PersonRow, Stat, StatRow, Tag } from './parts';

/** The caller's seat: the Agent ID hosts type, and whom they have asked to join. */
export function AgentSeatCard({ seat }: { seat: AgentSeat }) {
  const { t } = useTranslation();
  const agents = useAgents(seat.canManageAgents);
  const inventory = useInventory(seat.isOwner);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(String(seat.publicId));
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const roster = agents.data ?? [];
  const hostCount = roster.reduce((total, agent) => total + agent.hostCount, 0);

  return (
    <Animated.View entering={FadeInDown.duration(220)}>
      <Card>
        <Column gap="md">
          <Row gap="md">
            <View style={styles.agencyMark}>
              <Ionicons name="business" size={22} color={colors.brand.accent} />
            </View>
            <Column gap="xs" flex={1}>
              <Text variant="title" numberOfLines={1}>
                {seat.agency.name}
              </Text>
              <Row gap="xs" wrap>
                {seat.isOwner && (
                  <Tag
                    label={t('agents.owner')}
                    colour={colors.brand.accent}
                    soft={colors.brand.soft}
                    icon="star"
                  />
                )}
                {seat.agency.isHouse && (
                  <Tag
                    label={t('agency.house')}
                    colour={colors.text.secondary}
                    soft={colors.bg.raised}
                  />
                )}
              </Row>
            </Column>
          </Row>

          {/* The three numbers that describe an agency, as numbers. */}
          <StatRow>
            <Stat
              value={String(roster.length || (seat.canManageAgents ? 0 : 1))}
              label={t('agents.title')}
              icon="people"
            />
            <Stat value={String(hostCount)} label={t('agency.hostsLabel')} icon="mic" />
            {seat.isOwner && (
              <Stat
                value={
                  inventory.data === undefined ? '—' : formatCoins(asCoins(inventory.data.coins))
                }
                label={t('agencyCoins.inventoryTitle')}
                tone="coin"
                icon="server"
              />
            )}
          </StatRow>

          {/* The Agent ID is the one thing on this screen people copy out. */}
          <Pressable
            onPress={() => void copy()}
            accessibilityRole="button"
            accessibilityLabel={t('agency.agentIdShare', { id: seat.publicId })}
            style={styles.idBox}
            testID="my-agent-id"
          >
            <Column gap="xs" flex={1}>
              <Text variant="micro" tone="faint">
                {t('agency.agentIdHelp')}
              </Text>
              <Text variant="heading" selectable>
                {seat.publicId}
              </Text>
            </Column>
            <Row gap="xs">
              <Ionicons
                name={copied ? 'checkmark-circle' : 'copy-outline'}
                size={18}
                color={colors.brand.accent}
              />
              <Text variant="caption" style={{ color: colors.brand.accent }}>
                {copied ? t('agency.copied') : t('agency.copy')}
              </Text>
            </Row>
          </Pressable>
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
  const data = inventory.data;

  return (
    <Card>
      <Column gap="md">
        <CardTitle
          icon="server"
          title={t('agencyCoins.inventoryTitle')}
          colour={colors.currency.coin}
        />

        {inventory.isError ? (
          <Text variant="caption" tone="secondary">
            {t('agencyCoins.notTradingTitle')}
          </Text>
        ) : data === undefined ? (
          <Skeleton height={72} rounding="md" />
        ) : (
          <>
            <Row justify="between" align="end" style={styles.coinTile}>
              <Column gap="xs">
                <Text variant="display" style={{ color: colors.currency.coin }}>
                  {formatCoins(asCoins(data.coins))}
                </Text>
                <Text variant="micro" tone="faint">
                  {t('agencyCoins.usedToday', {
                    coins: formatCoins(asCoins(data.usedToday.coins)),
                    count: data.usedToday.count,
                  })}
                </Text>
              </Column>
              <Ionicons name="server" size={32} color={colors.currency.coin} />
            </Row>
            {data.isNewAgency && (
              <Tag
                label={t('agencyCoins.newAgencyCaps')}
                colour={colors.status.warning}
                soft={colors.status.warningSoft}
                icon="information-circle"
              />
            )}
          </>
        )}

        <Button
          label={t('agencyCoins.transferTitle')}
          onPress={() => {
            haptic.selection();
            router.push('/(app)/agency/coins');
          }}
          variant="secondary"
          fullWidth
          testID="coin-stock-row"
        />
      </Column>
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
        <CardTitle icon="person-add" title={t('agency.applicationsTitle')} />
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
              <PersonRow person={r.host} subtitle={t('agency.idLabel', { id: r.host.publicId })} />
              {r.message !== null && (
                <Text variant="caption" tone="secondary" style={styles.quote}>
                  “{r.message}”
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
          <CardTitle icon="link" title={t('agency.inviteTitle')} />
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
        <CardTitle icon="exit-outline" title={t('agency.leavingTitle')} />
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
              <PersonRow
                person={q.host}
                subtitle={t('agency.idLabel', { id: q.host.publicId })}
                tags={
                  q.status === 'pending' && q.autoLeaveAt !== null ? (
                    <Tag
                      label={t('agency.leavesOn', { date: formatDay(q.autoLeaveAt, locale) })}
                      colour={colors.status.warning}
                      soft={colors.status.warningSoft}
                      icon="time-outline"
                    />
                  ) : q.approvableUntil !== null ? (
                    <Tag
                      label={t('agency.declinedCanApprove', {
                        date: formatDay(q.approvableUntil, locale),
                      })}
                      colour={colors.text.secondary}
                      soft={colors.bg.raised}
                    />
                  ) : undefined
                }
              />
              <Text variant="caption" tone="secondary" style={styles.quote}>
                “{q.reason}”
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
  agencyMark: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.soft,
  },
  coinTile: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.currency.coinSoft,
  },
  quote: { fontStyle: 'italic' },
  idBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand.soft,
  },
});
