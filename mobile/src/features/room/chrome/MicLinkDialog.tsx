import { Modal, StyleSheet } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { colors, radius, spacing } from '@/theme';
import { Avatar, Button, Column, Text } from '@/ui';

/**
 * The three answers somebody gets after asking for the mic.
 *
 * All three are in the references, and the third was missing from our room
 * entirely:
 *
 *   waiting    asked, the host has not answered — offers to keep waiting or
 *              withdraw, because a request with no way out traps people
 *   queued     on the list, position unknown; one button, which is an
 *              acknowledgement rather than a decision
 *   follow     refused BEFORE it was sent: this host only takes mic requests
 *              from followers. A rule, not a failure, so it offers the fix
 */
export type MicLinkState = 'waiting' | 'queued' | 'follow' | null;

interface Props {
  state: MicLinkState;
  hostName: string | null;
  hostAvatar: string | null;
  followPending: boolean;
  onKeepWaiting: () => void;
  onWithdraw: () => void;
  onFollow: () => void;
  onDismiss: () => void;
}

/**
 * ── Why a Modal and not the app's Sheet ─────────────────────────────────────
 *
 * A sheet is dismissed by dragging it away, which is right for something you
 * opened and wrong for an answer to a question you asked. These interrupt, and
 * each one leaves with a decision: keep waiting, withdraw, follow, or
 * acknowledge. The references use a centred card for exactly this set.
 */
export function MicLinkDialog({
  state,
  hostName,
  hostAvatar,
  followPending,
  onKeepWaiting,
  onWithdraw,
  onFollow,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  if (state === null) return null;

  return (
    <Modal transparent animationType="none" visible onRequestClose={onDismiss}>
      <Animated.View entering={FadeIn.duration(140)} style={styles.scrim}>
        <Animated.View entering={ZoomIn.duration(180)} style={styles.card} testID="mic-link-dialog">
          <Column gap="lg" align="center">
            {state === 'follow' && <Avatar name={hostName ?? '—'} uri={hostAvatar} size="lg" />}

            <Column gap="sm" align="center">
              <Text variant="heading" style={styles.centre}>
                {state === 'waiting'
                  ? t('room.micWaitingTitle')
                  : state === 'queued'
                    ? t('room.micQueuedTitle')
                    : t('room.micFollowTitle')}
              </Text>
              <Text variant="caption" tone="secondary" style={styles.centre}>
                {state === 'waiting'
                  ? t('room.micWaitingBody')
                  : state === 'queued'
                    ? t('room.micQueuedBody')
                    : t('room.micFollowBody', { name: hostName ?? '' })}
              </Text>
            </Column>

            <Column gap="sm" style={styles.actions}>
              {state === 'waiting' && (
                <>
                  <Button
                    label={t('room.micKeepWaiting')}
                    onPress={onKeepWaiting}
                    fullWidth
                    testID="mic-keep-waiting"
                  />
                  <Button
                    label={t('room.micWithdraw')}
                    onPress={onWithdraw}
                    variant="ghost"
                    fullWidth
                    testID="mic-withdraw"
                  />
                </>
              )}

              {state === 'queued' && (
                <Button
                  label={t('common.ok')}
                  onPress={onDismiss}
                  fullWidth
                  testID="mic-queued-ok"
                />
              )}

              {state === 'follow' && (
                <>
                  <Button
                    label={t('room.follow')}
                    onPress={onFollow}
                    loading={followPending}
                    fullWidth
                    testID="mic-follow"
                  />
                  <Button
                    label={t('common.cancel')}
                    onPress={onDismiss}
                    variant="ghost"
                    fullWidth
                  />
                </>
              )}
            </Column>
          </Column>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.bg.scrim,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: colors.bg.surface,
  },
  centre: { textAlign: 'center' },
  actions: { width: '100%' },
});
