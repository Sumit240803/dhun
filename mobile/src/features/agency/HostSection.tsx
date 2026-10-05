import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import {
  useAnswerRequest,
  useCancelRequest,
  useHostCode,
  useJoinAgent,
  useJoinRequests,
  useReceivedCoins,
  useRotateHostCode,
} from '@/api/queries/useAgency';
import type { AgencyMembership, QuitRequest } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage, fieldError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import {
  Badge,
  Banner,
  Button,
  Card,
  Column,
  Divider,
  Input,
  Row,
  Skeleton,
  Text,
  type SheetHandle,
} from '@/ui';
import { TransferRow } from '@/features/agency/TransferRow';

import { formatDay, personName } from './format';
import { QuitSheet } from './QuitSheet';

/** The host's agency, the state of any application to leave, and the way out. */
export function MembershipCard({
  membership,
  quitRequest,
}: {
  membership: AgencyMembership;
  quitRequest: QuitRequest | null;
}) {
  const { t, locale } = useTranslation();
  const sheet = useRef<SheetHandle>(null);

  // Only an application made during THIS membership is relevant here.
  const current =
    quitRequest !== null && quitRequest.createdAt >= membership.joinedAt ? quitRequest : null;

  return (
    <Animated.View entering={FadeInDown.duration(220)}>
      <Card>
        <Column gap="md">
          <Column gap="xs">
            <Text variant="micro" tone="faint">
              {t('agency.memberOf')}
            </Text>
            <Row gap="sm">
              <Text variant="title" style={styles.shrink} numberOfLines={1}>
                {membership.agency.name}
              </Text>
              {membership.agency.isHouse && <Badge label={t('agency.house')} tone="brand" />}
            </Row>
            <Text variant="caption" tone="secondary">
              {t('agency.agencyId', { id: membership.agency.publicId })} ·{' '}
              {t('agency.joinedOn', { date: formatDay(membership.joinedAt, locale) })}
            </Text>
          </Column>

          <Divider />
          <Row justify="between">
            <Column gap="xs">
              <Text variant="micro" tone="faint">
                {t('agency.agent')}
              </Text>
              <Text variant="bodyStrong">{personName(membership.agent)}</Text>
            </Column>
            <Column gap="xs" align="end">
              <Text variant="micro" tone="faint">
                {t('agency.owner')}
              </Text>
              <Text variant="bodyStrong">{personName(membership.owner)}</Text>
            </Column>
          </Row>

          {current?.status === 'pending' && current.autoLeaveAt !== null && (
            <Column gap="xs" style={styles.notice}>
              <Text variant="bodyStrong">{t('agency.quitPendingTitle')}</Text>
              <Text variant="caption" tone="secondary">
                {t('agency.quitPendingBody', { date: formatDay(current.autoLeaveAt, locale) })}
              </Text>
            </Column>
          )}
          {current?.status === 'rejected' && (
            <Column gap="xs" style={styles.notice}>
              <Text variant="bodyStrong">{t('agency.quitRejectedTitle')}</Text>
              <Text variant="caption" tone="secondary">
                {t('agency.quitRejectedBody', { date: formatDay(current.nextApplyAt, locale) })}
              </Text>
            </Column>
          )}
        </Column>
      </Card>

      {current?.status !== 'pending' && (
        <Pressable
          onPress={() => {
            haptic.selection();
            sheet.current?.present();
          }}
          accessibilityRole="button"
          style={styles.quitLink}
          hitSlop={spacing.sm}
          testID="quit-link"
        >
          <Text variant="caption" tone="secondary">
            {t('agency.quitLink')}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.text.secondary} />
        </Pressable>
      )}

      <QuitSheet ref={sheet} onLeft={() => undefined} />
    </Animated.View>
  );
}

/** Route 1: type the Agent ID. */
export function JoinCard() {
  const { t } = useTranslation();
  const join = useJoinAgent();
  const [agentId, setAgentId] = useState('');

  return (
    <Animated.View entering={FadeInDown.duration(220)}>
      <Card>
        <Column gap="md">
          <Column gap="xs">
            <Text variant="heading">{t('agency.joinTitle')}</Text>
            <Text variant="caption" tone="secondary">
              {t('agency.joinBody')}
            </Text>
          </Column>
          <Input
            label={t('agency.agentIdLabel')}
            value={agentId}
            onChangeText={(next) => setAgentId(next.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={8}
            error={fieldError(join.error, 'agentId')}
            testID="agent-id"
          />
          {join.isSuccess && <Banner tone="info" message={t('agency.requestSent')} />}
          {join.error != null && fieldError(join.error, 'agentId') === undefined && (
            <Banner message={errorMessage(join.error)} />
          )}
          <Button
            label={t('agency.sendRequest')}
            onPress={() => {
              haptic.tap();
              join.mutate(Number(agentId), {
                onSuccess: () => {
                  haptic.success();
                  setAgentId('');
                },
                onError: () => haptic.error(),
              });
            }}
            disabled={agentId.length < 6}
            loading={join.isPending}
            fullWidth
            testID="send-join"
          />
        </Column>
      </Card>
    </Animated.View>
  );
}

/** The second factor an agent needs to invite this host. */
export function HostCodeCard({ userPublicId }: { userPublicId: string | undefined }) {
  const { t } = useTranslation();
  const code = useHostCode();
  const rotate = useRotateHostCode();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (code.data === undefined) return;
    await Clipboard.setStringAsync(code.data.code);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Card>
      <Column gap="md">
        <Column gap="xs">
          <Text variant="heading">{t('agency.codeTitle')}</Text>
          <Text variant="caption" tone="secondary">
            {t('agency.codeBody')}
          </Text>
        </Column>
        {code.isError ? (
          <Banner message={errorMessage(code.error)} onRetry={() => void code.refetch()} />
        ) : (
          <Row justify="between" style={styles.codeBox}>
            <Column gap="xs">
              {userPublicId !== undefined && (
                <Text variant="micro" tone="faint">
                  {t('agency.yourUserId', { id: userPublicId })}
                </Text>
              )}
              <Text variant="title" selectable testID="host-code">
                {code.data?.code ?? '······'}
              </Text>
            </Column>
            <Button
              label={copied ? t('agency.copied') : t('agency.copy')}
              onPress={() => void copy()}
              variant="ghost"
              size="sm"
            />
          </Row>
        )}
        <Row justify="between">
          <Text variant="caption" tone="faint" style={styles.shrink}>
            {t('agency.newCodeBody')}
          </Text>
          <Button
            label={t('agency.newCode')}
            onPress={() => {
              haptic.tap();
              rotate.mutate(undefined, { onSuccess: () => haptic.success() });
            }}
            loading={rotate.isPending}
            variant="secondary"
            size="sm"
          />
        </Row>
      </Column>
    </Card>
  );
}

/**
 * Coins an agency has sent this user.
 *
 * Their half of a record neither side can edit — which is the only thing we
 * can offer someone who paid an agency off-platform, and so is worth showing
 * even when it is empty of anything but an explanation.
 */
export function ReceivedCoinsCard() {
  const { t, locale } = useTranslation();
  const received = useReceivedCoins(true);
  if (received.data !== undefined && received.data.length === 0) return null;

  return (
    <Card>
      <Column gap="md">
        <Text variant="heading">{t('agencyCoins.receivedTitle')}</Text>
        {received.isError ? (
          <Banner message={errorMessage(received.error)} onRetry={() => void received.refetch()} />
        ) : received.data === undefined ? (
          <Skeleton height={44} rounding="md" />
        ) : (
          received.data.map((transfer, i) => (
            <Column key={transfer.id} gap="sm">
              {i > 0 && <Divider />}
              <TransferRow transfer={transfer} locale={locale} outgoing={false} />
            </Column>
          ))
        )}
      </Column>
    </Card>
  );
}

/** Invitations to answer, and the host's own applications still waiting. */
export function HostRequests() {
  const { t, locale } = useTranslation();
  const requests = useJoinRequests();
  const answer = useAnswerRequest();
  const cancel = useCancelRequest();

  const invites = requests.data?.asHost.filter((r) => r.direction === 'agent_invited') ?? [];
  const mine = requests.data?.asHost.filter((r) => r.direction === 'host_applied') ?? [];
  if (invites.length === 0 && mine.length === 0) return null;

  const failure = answer.error ?? cancel.error;

  return (
    <Card>
      <Column gap="md">
        {invites.length > 0 && <Text variant="heading">{t('agency.invitesTitle')}</Text>}
        {invites.map((r) => (
          <Column key={r.id} gap="sm">
            <Text variant="bodyStrong">
              {t('agency.invitedBy', { agent: personName(r.agent), agency: r.agency.name })}
            </Text>
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
                testID={`accept-${r.id}`}
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
        ))}

        {mine.length > 0 && <Text variant="heading">{t('agency.yourRequests')}</Text>}
        {mine.map((r) => (
          <Row key={r.id} justify="between" gap="md">
            <Text variant="caption" tone="secondary" style={styles.shrink}>
              {t('agency.waitingFor', {
                agent: `${personName(r.agent)} · ${r.agency.name}`,
                date: formatDay(r.expiresAt, locale),
              })}
            </Text>
            <Button
              label={t('agency.withdraw')}
              onPress={() => {
                haptic.selection();
                cancel.mutate(r.id);
              }}
              variant="ghost"
              size="sm"
            />
          </Row>
        ))}

        {failure != null && <Banner message={errorMessage(failure)} />}
      </Column>
    </Card>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  notice: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.status.warningSoft,
  },
  quitLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  codeBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border.strong,
  },
});
