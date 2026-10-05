import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import {
  useAgentInvites,
  useAgents,
  useAnswerAgentInvite,
  useCancelAgentInvite,
  useInviteAgent,
  useRemoveAgent,
  useSetAgentManagement,
} from '@/api/queries/useAgency';
import type { RosterAgent } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage, fieldError } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Column,
  Divider,
  Input,
  Row,
  Sheet,
  Skeleton,
  Text,
  type SheetHandle,
} from '@/ui';

import { personName } from './format';

/** The agency's agents, and what each of them is holding. */
export function AgentRoster({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const agents = useAgents(canManage);
  const [selected, setSelected] = useState<RosterAgent | null>(null);
  const sheet = useRef<SheetHandle>(null);

  if (!canManage) return null;

  return (
    <Animated.View entering={FadeInDown.duration(220)}>
      <Card>
        <Column gap="md">
          <Text variant="heading">{t('agents.rosterTitle')}</Text>

          {agents.isError ? (
            <Banner message={errorMessage(agents.error)} onRetry={() => void agents.refetch()} />
          ) : agents.data === undefined ? (
            <Skeleton height={56} rounding="md" />
          ) : (
            agents.data.map((agent, i) => (
              <Column key={agent.id} gap="sm">
                {i > 0 && <Divider />}
                <Row justify="between" gap="md">
                  <Column gap="xs" flex={1}>
                    <Row gap="sm">
                      <Text variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
                        {personName({ displayName: agent.displayName, publicId: agent.publicId })}
                      </Text>
                      {agent.isOwner && <Badge label={t('agents.owner')} tone="brand" />}
                      {!agent.isOwner && agent.canManageAgents && (
                        <Badge label={t('agents.canManage')} tone="neutral" />
                      )}
                    </Row>
                    <Text variant="micro" tone="faint">
                      {t('agents.agentId', { id: agent.publicId })} ·{' '}
                      {agent.hostCount === 0
                        ? t('agents.noHosts')
                        : t('agents.hostCount', { count: agent.hostCount })}
                    </Text>
                  </Column>
                  {!agent.isOwner && (
                    <Button
                      label={t('agents.manage')}
                      onPress={() => {
                        haptic.selection();
                        setSelected(agent);
                        sheet.current?.present();
                      }}
                      variant="ghost"
                      size="sm"
                      testID={`manage-${agent.publicId}`}
                    />
                  )}
                </Row>
              </Column>
            ))
          )}
        </Column>
      </Card>

      <ManageAgentSheet ref={sheet} agent={selected} />
    </Animated.View>
  );
}

/**
 * What to do with one agent.
 *
 * Removal states the consequence in the sentence rather than the small print:
 * their hosts move to the owner, and nobody leaves the agency. That is the
 * thing an owner would otherwise have to find out by doing it.
 */
function ManageAgentSheet({
  ref,
  agent,
}: {
  ref: React.Ref<SheetHandle>;
  agent: RosterAgent | null;
}) {
  const { t } = useTranslation();
  const remove = useRemoveAgent();
  const management = useSetAgentManagement();
  const [confirming, setConfirming] = useState(false);

  function close() {
    setConfirming(false);
    remove.reset();
    management.reset();
    if (typeof ref === 'object' && ref?.current) ref.current.dismiss();
  }

  if (agent === null) return null;
  const name = personName({ displayName: agent.displayName, publicId: agent.publicId });
  const failure = remove.error ?? management.error;

  return (
    <Sheet
      ref={ref}
      title={confirming ? t('agents.removeTitle', { name }) : name}
      onDismiss={() => {
        setConfirming(false);
        remove.reset();
        management.reset();
      }}
    >
      <Column gap="md">
        {confirming ? (
          <>
            <Text variant="body" tone="secondary">
              {agent.hostCount === 0
                ? t('agents.removeBodyNoHosts')
                : t('agents.removeBody', { count: agent.hostCount })}
            </Text>
            {failure != null && <Banner message={errorMessage(failure)} />}
            <Button
              label={t('agents.remove')}
              onPress={() => {
                haptic.tap();
                remove.mutate(agent.id, {
                  onSuccess: () => {
                    haptic.success();
                    close();
                  },
                  onError: () => haptic.error(),
                });
              }}
              loading={remove.isPending}
              variant="danger"
              fullWidth
              testID="confirm-remove-agent"
            />
            <Button
              label={t('agents.cancel')}
              onPress={() => setConfirming(false)}
              variant="ghost"
              fullWidth
            />
          </>
        ) : (
          <>
            <Text variant="caption" tone="secondary">
              {t('agents.agentId', { id: agent.publicId })} ·{' '}
              {agent.hostCount === 0
                ? t('agents.noHosts')
                : t('agents.hostCount', { count: agent.hostCount })}
            </Text>
            {failure != null && <Banner message={errorMessage(failure)} />}
            <Button
              label={agent.canManageAgents ? t('agents.revokeManage') : t('agents.grantManage')}
              onPress={() => {
                haptic.tap();
                management.mutate(
                  { id: agent.id, canManageAgents: !agent.canManageAgents },
                  { onSuccess: () => haptic.success(), onError: () => haptic.error() },
                );
              }}
              loading={management.isPending}
              variant="secondary"
              fullWidth
            />
            <Button
              label={t('agents.remove')}
              onPress={() => {
                haptic.selection();
                setConfirming(true);
              }}
              variant="ghost"
              fullWidth
            />
          </>
        )}
      </Column>
    </Sheet>
  );
}

/** Offering someone a seat, and the offers still outstanding. */
export function InviteAgentCard({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const invite = useInviteAgent();
  const invites = useAgentInvites(canManage);
  const cancel = useCancelAgentInvite();
  const [userId, setUserId] = useState('');
  const [withManagement, setWithManagement] = useState(false);

  if (!canManage) return null;
  const pending = invites.data?.sent ?? [];
  const userIdError = fieldError(invite.error, 'userId');

  return (
    <Card>
      <Column gap="md">
        <Column gap="xs">
          <Text variant="heading">{t('agents.inviteTitle')}</Text>
          <Text variant="caption" tone="secondary">
            {t('agents.inviteBody')}
          </Text>
        </Column>

        <Input
          label={t('agents.userIdLabel')}
          value={userId}
          onChangeText={(next) => setUserId(next.replace(/\D/g, ''))}
          keyboardType="number-pad"
          maxLength={8}
          error={userIdError}
          testID="agent-invite-user-id"
        />
        <Checkbox
          checked={withManagement}
          onChange={setWithManagement}
          accessibilityLabel={t('agents.canManageLabel')}
        >
          <Text variant="caption">{t('agents.canManageLabel')}</Text>
        </Checkbox>

        {invite.isSuccess && <Banner tone="info" message={t('agents.inviteSent')} />}
        {invite.error != null && userIdError === undefined && (
          <Banner message={errorMessage(invite.error)} />
        )}

        <Button
          label={t('agents.sendInvite')}
          onPress={() => {
            haptic.tap();
            invite.mutate(
              { userId: Number(userId), canManageAgents: withManagement },
              {
                onSuccess: () => {
                  haptic.success();
                  setUserId('');
                  setWithManagement(false);
                },
                onError: () => haptic.error(),
              },
            );
          }}
          disabled={userId.length < 8}
          loading={invite.isPending}
          variant="secondary"
          fullWidth
          testID="send-agent-invite"
        />

        {pending.length > 0 && (
          <>
            <Divider />
            <Text variant="bodyStrong">{t('agents.pendingTitle')}</Text>
            {pending.map((item) => (
              <Row key={item.id} justify="between" gap="md">
                <Text variant="caption" tone="secondary" style={styles.shrink}>
                  {personName(item.invited)}
                </Text>
                <Button
                  label={t('agents.withdraw')}
                  onPress={() => {
                    haptic.selection();
                    cancel.mutate(item.id);
                  }}
                  variant="ghost"
                  size="sm"
                />
              </Row>
            ))}
          </>
        )}
      </Column>
    </Card>
  );
}

/** An offer made to the person looking at the screen. */
export function AgentInviteCard() {
  const { t } = useTranslation();
  const invites = useAgentInvites();
  const answer = useAnswerAgentInvite();
  const mine = invites.data?.mine ?? [];
  if (mine.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.duration(220)}>
      <Card>
        <Column gap="md">
          <Text variant="heading">{t('agents.myInviteTitle')}</Text>
          {mine.map((invite) => (
            <Column key={invite.id} gap="sm">
              <Row gap="sm" align="start" style={styles.notice}>
                <Ionicons name="briefcase-outline" size={18} color={colors.brand.accent} />
                <Column gap="xs" flex={1}>
                  <Text variant="body">
                    {t('agents.myInviteBody', { agency: invite.agency.name })}
                  </Text>
                  {invite.canManageAgents && (
                    <Text variant="caption" tone="secondary">
                      {t('agents.myInviteManage')}
                    </Text>
                  )}
                  {invite.message !== null && (
                    <Text variant="caption" tone="secondary">
                      “{invite.message}”
                    </Text>
                  )}
                </Column>
              </Row>
              <Row gap="sm">
                <Button
                  label={t('agents.accept')}
                  onPress={() => {
                    haptic.tap();
                    answer.mutate(
                      { id: invite.id, accept: true },
                      { onSuccess: () => haptic.success(), onError: () => haptic.error() },
                    );
                  }}
                  size="sm"
                  testID={`accept-agent-${invite.id}`}
                />
                <Button
                  label={t('agents.decline')}
                  onPress={() => {
                    haptic.selection();
                    answer.mutate({ id: invite.id, accept: false });
                  }}
                  variant="secondary"
                  size="sm"
                />
              </Row>
            </Column>
          ))}
          {answer.error != null && <Banner message={errorMessage(answer.error)} />}
        </Column>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  notice: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand.soft,
  },
});
