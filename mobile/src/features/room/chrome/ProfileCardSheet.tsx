import { Ionicons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePublicProfile } from '@/api/queries/useSocial';
import type { FanLevel } from '@/api/types';
import { FanBadge } from '@/visuals/FanBadge';
import { VipBadge } from '@/visuals/VipBadge';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatCompact } from '@/lib/money';
import { colors, radius, spacing } from '@/theme';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Column,
  Row,
  Sheet,
  Skeleton,
  Text,
  type SheetHandle,
} from '@/ui';
import { LevelBadge } from '@/visuals/LevelBadge';

/** Who the card is about, known before the profile has loaded. */
export interface ProfileTarget {
  userId: string;
  displayName: string | null;
  /** Coins this person has been gifted in THIS room. */
  roomCoins?: number;
  /** Host-only controls are offered when we are the host and they are not us. */
  manageable?: boolean;
  /** They hold this seat; absent for a viewer tapped from chat. */
  seatIndex?: number;
  muted?: boolean;
  /** This person is a room admin. */
  isAdmin?: boolean;
  /** This person hosts the room. */
  isHost?: boolean;
  /** The viewer is the host and may appoint or remove this person as admin. */
  canAppoint?: boolean;
  /** The viewer moderates as an ADMIN, not the host — the section is titled for it. */
  viewerIsAdmin?: boolean;
}

interface Props {
  target: ProfileTarget | null;
  isSelf: boolean;
  canGift: boolean;
  onGift: (userId: string) => void;
  onOpenProfile: (userId: string) => void;
  onMute: (userId: string, muted: boolean) => void;
  onKick: (userId: string) => void;
  onRemoveFromSeat: (userId: string) => void;
  onAppointAdmin: (userId: string) => void;
  onRemoveAdmin: (userId: string) => void;
  /** The viewer's own fan level with the host, shown on the host's card. */
  fanWithHost?: FanLevel | null;
}

/**
 * Tap a face, see who it is.
 *
 * ── Why this is a sheet and not a route ─────────────────────────────────────
 *
 * The references open a card over the room, and that is the right call for one
 * reason: leaving the room to look someone up means leaving the audio, the
 * chat and the battle you were watching. The full profile is still a tap away
 * for anyone who wants it.
 *
 * ── Why the gift button is the primary action ───────────────────────────────
 *
 * It is the only reason most people open this card. The reference card leads
 * with `Give Gifts` for the same reason, and the host controls sit below the
 * fold where a mis-tap cannot kick somebody.
 */
export const ProfileCardSheet = forwardRef<SheetHandle, Props>(function ProfileCardSheet(
  {
    target,
    isSelf,
    canGift,
    onGift,
    onOpenProfile,
    onMute,
    onKick,
    onRemoveFromSeat,
    onAppointAdmin,
    onRemoveAdmin,
    fanWithHost = null,
  },
  ref,
) {
  const { t } = useTranslation();
  const profile = usePublicProfile(target?.userId);

  return (
    <Sheet ref={ref} title={target?.displayName ?? t('profile.title')}>
      {target === null ? null : (
        <Column gap="lg">
          <Row gap="md" align="center">
            <Avatar
              name={target.displayName ?? '—'}
              uri={profile.data?.avatarUrl ?? null}
              size="lg"
            />
            <Column gap="xs" flex={1}>
              <Row gap="xs" align="center">
                <Text variant="heading" numberOfLines={1} style={styles.name}>
                  {profile.data?.displayName ?? target.displayName ?? '—'}
                </Text>
                {profile.data?.look.vip ? <VipBadge tier={profile.data.look.vip} /> : null}
                {target.isAdmin === true && <Badge label={t('room.adminBadge')} tone="success" />}
              </Row>

              {profile.isLoading ? (
                <Skeleton width={120} height={14} />
              ) : (
                <Row gap="xs" align="center">
                  {profile.data !== undefined && <LevelBadge level={profile.data.userLevel} />}
                  {profile.data?.publicId !== undefined && (
                    <Text variant="micro" tone="faint">
                      {t('room.idLabel', { code: profile.data.publicId })}
                    </Text>
                  )}
                </Row>
              )}
            </Column>
          </Row>

          {profile.isError && <Banner message={errorMessage(profile.error)} />}

          {/* Your standing with this host — the number a fan badge in chat is
              about. Only on the host's card, and never for the host. */}
          {target.isHost && !isSelf && fanWithHost !== null && (
            <View style={styles.stat} testID="fan-standing">
              <FanBadge level={fanWithHost.level} />
              <Text variant="caption" tone="secondary" style={styles.fanText}>
                {fanWithHost.level === 0
                  ? t('room.fanNone')
                  : fanWithHost.nextAt === null
                    ? t('room.fanTop', { level: fanWithHost.level })
                    : t('room.fanLine', {
                        level: fanWithHost.level,
                        coins: formatCompact(fanWithHost.nextAt - fanWithHost.coins),
                      })}
              </Text>
            </View>
          )}

          {/* What they have been given HERE. The number that makes somebody
              decide to out-gift them, which is why it is on the card at all. */}
          {target.roomCoins !== undefined && target.roomCoins > 0 && (
            <View style={styles.stat}>
              <Ionicons name="gift" size={14} color={colors.brand.accent} />
              <Text variant="caption" tone="secondary">
                {t('room.receivedHere', { coins: formatCompact(target.roomCoins) })}
              </Text>
            </View>
          )}

          <Column gap="sm">
            {canGift && !isSelf && (
              <Button
                label={t('gifting.sendTo', { name: target.displayName ?? '' })}
                onPress={() => onGift(target.userId)}
                fullWidth
                testID="profile-card-gift"
              />
            )}
            <Button
              label={t('room.viewProfile')}
              onPress={() => onOpenProfile(target.userId)}
              variant="secondary"
              fullWidth
              testID="profile-card-open"
            />
          </Column>

          {/* Host controls, last. Silencing or removing somebody is not a thing
              to put under a thumb reaching for "send a gift". */}
          {(target.manageable === true || target.canAppoint === true) && (
            <Column gap="sm">
              <Text variant="micro" tone="faint">
                {target.viewerIsAdmin === true ? t('room.adminControls') : t('room.hostControls')}
              </Text>
              {target.canAppoint === true && (
                <Button
                  label={target.isAdmin === true ? t('room.removeAdmin') : t('room.makeAdmin')}
                  onPress={() =>
                    target.isAdmin === true
                      ? onRemoveAdmin(target.userId)
                      : onAppointAdmin(target.userId)
                  }
                  variant="secondary"
                  fullWidth
                  testID="profile-card-admin"
                />
              )}
              {target.manageable === true && target.seatIndex !== undefined && (
                <>
                  <Button
                    label={target.muted === true ? t('room.unmute') : t('room.mute')}
                    onPress={() => onMute(target.userId, target.muted !== true)}
                    variant="secondary"
                    fullWidth
                    testID="profile-card-mute"
                  />
                  <Button
                    label={t('room.removeFromSeat')}
                    onPress={() => onRemoveFromSeat(target.userId)}
                    variant="secondary"
                    fullWidth
                    testID="profile-card-remove"
                  />
                </>
              )}
              {target.manageable === true && (
                <Button
                  label={t('room.kick')}
                  onPress={() => onKick(target.userId)}
                  variant="danger"
                  fullWidth
                  testID="profile-card-kick"
                />
              )}
            </Column>
          )}
        </Column>
      )}
    </Sheet>
  );
});

const styles = StyleSheet.create({
  fanText: { flex: 1 },
  name: { flexShrink: 1 },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg.raised,
  },
});
