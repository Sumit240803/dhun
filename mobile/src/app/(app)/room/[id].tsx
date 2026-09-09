import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useJoinRoom, useRoomActions, useRoomDetail } from '@/api/queries/useRoom';
import { ApiErrorCode, type JoinedRoom, type RoomSeat } from '@/api/types';
import { isLiveKitAvailable } from '@/features/room/livekit';
import { useLiveRoom } from '@/features/room/useLiveRoom';
import { useTranslation } from '@/i18n';
import { errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { useSession } from '@/store/session';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Column,
  EmptyState,
  Row,
  Screen,
  Sheet,
  Text,
  type SheetHandle,
} from '@/ui';

/**
 * A live room.
 *
 * Full-bleed — `edges={[]}` — because the room is the whole screen and its own
 * chrome insets itself. That is the one case the Screen contract carves out.
 *
 * The seat map is POLLED, not pushed. The WebSocket gateway that would push it
 * is the other half of M5 and is not built; three seconds is fast enough that
 * a seat change feels immediate without twenty people becoming twenty requests
 * a second. This is the first thing the gateway replaces.
 */
export default function RoomScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();

  const [joined, setJoined] = useState<JoinedRoom | null>(null);
  const join = useJoinRoom();
  const detail = useRoomDetail(id, joined !== null);
  const actions = useRoomActions(id);

  const leaveSheet = useRef<SheetHandle>(null);
  const manageSheet = useRef<SheetHandle>(null);
  const [managing, setManaging] = useState<RoomSeat | null>(null);

  // Joined once, on mount. Deliberately not a query: it mints a short-lived
  // credential, and a refetch on focus would hand the screen a token that had
  // already been superseded.
  useEffect(() => {
    if (!id) return;
    join.mutate(id, { onSuccess: setJoined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const room = detail.data?.room ?? joined?.room;
  const seats = detail.data?.seats ?? joined?.seats ?? [];
  const isHost = room?.hostId === user?.id;
  const mySeat = seats.find((seat) => seat.userId === user?.id);

  const live = useLiveRoom({
    url: joined?.rtc.url ?? null,
    token: joined?.rtc.token ?? null,
    publish: joined?.canPublish ?? false,
  });

  // The server can revoke a seat at any moment — the host takes the mic away
  // and LiveKit unpublishes the track without asking us. This reconciles our
  // microphone with whatever grant we actually hold now.
  useEffect(() => {
    if (live.connection !== 'connected') return;
    const shouldPublish = mySeat !== undefined && !mySeat.muted;
    void live.syncPublishing(shouldPublish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySeat?.seatIndex, mySeat?.muted, live.connection]);

  // The host ended it, or a moderator did. Nothing on this screen is usable
  // any more, so leaving is the only honest thing to do.
  useEffect(() => {
    if (isErrorCode(detail.error, ApiErrorCode.ROOM_ENDED)) {
      haptic.error();
      router.back();
    }
  }, [detail.error]);

  function leave() {
    haptic.selection();
    router.back();
  }

  if (!isLiveKitAvailable()) {
    return (
      <Screen padded>
        <EmptyState
          icon="cloud-offline-outline"
          title={t('room.unsupported')}
          body={t('update.availableBody')}
          actionLabel={t('common.back')}
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  if (join.error) {
    const banned = isErrorCode(join.error, ApiErrorCode.ROOM_BANNED);
    return (
      <Screen padded>
        <View style={styles.centre}>
          <EmptyState
            icon={banned ? 'hand-left-outline' : 'alert-circle-outline'}
            title={banned ? t('room.kicked') : t('room.joinFailed')}
            body={errorMessage(join.error)}
            actionLabel={t('common.back')}
            onAction={() => router.back()}
          />
          {traceReference(join.error) !== undefined && (
            <Text variant="micro" tone="faint" style={styles.trace}>
              {traceReference(join.error)}
            </Text>
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} edges={[]}>
      <LinearGradient
        colors={[colors.brand.soft, colors.bg.base]}
        style={[styles.header, { paddingTop: insets.top + spacing.md }]}
      >
        <Row gap="md">
          <Avatar name={room?.hostName ?? '—'} size="md" />
          <Column gap="xs" flex={1}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {room?.title ?? ''}
            </Text>
            <Row gap="xs">
              <Badge label={t('room.live')} tone="danger" />
              <Text variant="micro" tone="secondary">
                {t('room.viewers', {
                  count: live.connection === 'connected' ? live.participants : (room?.viewers ?? 0),
                })}
              </Text>
            </Row>
          </Column>

          <Pressable
            onPress={() => {
              haptic.tap();
              leaveSheet.current?.present();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('room.leave')}
            hitSlop={spacing.md}
          >
            <Ionicons name="close" size={26} color={colors.text.primary} />
          </Pressable>
        </Row>

        <ConnectionLine state={live.connection} />
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 96 }]}
        showsVerticalScrollIndicator={false}
      >
        {room?.seatCapacity != null ? (
          <View style={styles.grid}>
            {Array.from({ length: room.seatCapacity }, (_, index) => {
              const seat = seats.find((s) => s.seatIndex === index);
              return (
                <SeatTile
                  key={index}
                  index={index}
                  seat={seat}
                  hostId={room.hostId}
                  speaking={seat !== undefined && live.speaking.includes(seat.userId)}
                  emptyLabel={t('room.emptySeat')}
                  hostLabel={t('room.hostLabel')}
                  onPress={() => {
                    if (!seat) {
                      haptic.tap();
                      actions.takeSeat.mutate(index);
                      return;
                    }
                    if (isHost && seat.userId !== user?.id) {
                      haptic.selection();
                      setManaging(seat);
                      manageSheet.current?.present();
                    }
                  }}
                />
              );
            })}
          </View>
        ) : (
          <Animated.View entering={FadeIn.duration(240)} style={styles.solo}>
            <Avatar name={room?.hostName ?? '—'} size="xl" />
            <Text variant="heading">{room?.hostName ?? ''}</Text>
            <Text variant="caption" tone="secondary">
              {live.speaking.includes(room?.hostId ?? '') ? t('room.speaking') : ''}
            </Text>
          </Animated.View>
        )}

        {actions.takeSeat.error != null && (
          <View style={styles.banner}>
            <Banner message={errorMessage(actions.takeSeat.error)} />
          </View>
        )}
      </ScrollView>

      {/* The mic bar. Only ever shown to someone the SERVER put on a seat. */}
      <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]}>
        {mySeat !== undefined ? (
          <Row gap="md">
            <Button
              label={live.micOn ? t('room.micOn') : t('room.micOff')}
              onPress={() => {
                haptic.tap();
                void live.setMicOn(!live.micOn);
              }}
              // The host's mute is not ours to undo. Showing an enabled button
              // that silently fails is worse than showing a disabled one.
              disabled={mySeat.muted || live.connection !== 'connected'}
              variant={live.micOn ? 'primary' : 'secondary'}
              size="lg"
              fullWidth
              testID="toggle-mic"
            />
            {!isHost && (
              <Button
                label={t('room.leaveSeat')}
                onPress={() => {
                  haptic.tap();
                  actions.releaseSeat.mutate(user!.id);
                }}
                loading={actions.releaseSeat.isPending}
                variant="ghost"
                size="lg"
                testID="leave-seat"
              />
            )}
          </Row>
        ) : (
          room?.seatCapacity != null && (
            <Text variant="caption" tone="faint" style={styles.hint}>
              {t('room.takeSeat')}
            </Text>
          )
        )}
      </View>

      <Sheet ref={leaveSheet} title={isHost ? t('room.endTitle') : t('room.leaveTitle')}>
        <Text variant="body" tone="secondary">
          {isHost ? t('room.endBody') : ''}
        </Text>
        <Column gap="sm">
          <Button
            label={isHost ? t('room.end') : t('room.leave')}
            onPress={() => {
              if (isHost) {
                actions.endRoom.mutate(undefined, { onSuccess: leave });
                return;
              }
              leave();
            }}
            loading={actions.endRoom.isPending}
            variant="danger"
            fullWidth
            testID="confirm-leave"
          />
          <Button
            label={t('common.cancel')}
            onPress={() => leaveSheet.current?.dismiss()}
            variant="ghost"
            fullWidth
          />
        </Column>
      </Sheet>

      <Sheet ref={manageSheet} title={t('room.manageTitle', { name: managing?.displayName ?? '' })}>
        <Column gap="sm">
          <Button
            label={managing?.muted ? t('room.unmute') : t('room.mute')}
            onPress={() => {
              if (!managing) return;
              haptic.tap();
              actions.muteSeat.mutate(
                { userId: managing.userId, muted: !managing.muted },
                { onSuccess: () => manageSheet.current?.dismiss() },
              );
            }}
            loading={actions.muteSeat.isPending}
            variant="secondary"
            fullWidth
          />
          <Button
            label={t('room.removeFromSeat')}
            onPress={() => {
              if (!managing) return;
              haptic.tap();
              actions.releaseSeat.mutate(managing.userId, {
                onSuccess: () => manageSheet.current?.dismiss(),
              });
            }}
            variant="secondary"
            fullWidth
          />
          <Button
            label={t('room.kick')}
            onPress={() => {
              if (!managing) return;
              haptic.error();
              actions.kick.mutate(managing.userId, {
                onSuccess: () => manageSheet.current?.dismiss(),
              });
            }}
            loading={actions.kick.isPending}
            variant="danger"
            fullWidth
          />
        </Column>
      </Sheet>
    </Screen>
  );
}

/**
 * The connection state, shown only when it is not `connected`.
 *
 * A permanent "connected" badge is noise — the audio itself tells the user
 * that. What they need is a line when something is wrong.
 */
function ConnectionLine({ state }: { state: ReturnType<typeof useLiveRoom>['connection'] }) {
  const { t } = useTranslation();
  if (state === 'connected' || state === 'idle') return null;

  const label =
    state === 'failed'
      ? t('room.connectFailed')
      : state === 'reconnecting'
        ? t('room.reconnecting')
        : t('room.connecting');

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.connection}>
      <Text variant="micro" tone={state === 'failed' ? 'danger' : 'secondary'}>
        {label}
      </Text>
    </Animated.View>
  );
}

function SeatTile({
  index,
  seat,
  hostId,
  speaking,
  emptyLabel,
  hostLabel,
  onPress,
}: {
  index: number;
  seat?: RoomSeat;
  hostId: string;
  speaking: boolean;
  emptyLabel: string;
  hostLabel: string;
  onPress: () => void;
}) {
  // The speaking ring. A slow pulse rather than a hard on/off, because audio
  // levels flicker and a binary indicator would strobe.
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = speaking
      ? withRepeat(withTiming(1, { duration: 700 }), -1, true)
      : withTiming(0, { duration: 200 });
  }, [speaking, pulse]);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.35 + pulse.value * 0.65,
    transform: [{ scale: 1 + pulse.value * 0.06 }],
  }));

  return (
    <Animated.View entering={FadeInDown.duration(220).delay(index * 30)} style={styles.seat}>
      <Pressable onPress={onPress} accessibilityRole="button" style={styles.seatPress}>
        <View>
          {speaking && <Animated.View style={[styles.ring, ring]} />}
          {seat ? (
            <Avatar name={seat.displayName ?? '—'} size="lg" />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="add" size={22} color={colors.text.faint} />
            </View>
          )}
          {seat?.muted && (
            <View style={styles.mutedBadge}>
              <Ionicons name="mic-off" size={11} color={colors.text.onBrand} />
            </View>
          )}
        </View>

        <Text variant="micro" tone={seat ? 'secondary' : 'faint'} numberOfLines={1}>
          {seat ? (seat.userId === hostId ? hostLabel : (seat.displayName ?? '—')) : emptyLabel}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  connection: { alignItems: 'center' },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, justifyContent: 'center' },
  seat: { width: 84 },
  seatPress: { alignItems: 'center', gap: spacing.xs },
  ring: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.brand.accent,
  },
  empty: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.raised,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderStyle: 'dashed',
  },
  mutedBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.status.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  solo: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  banner: { marginTop: spacing.xl },
  bar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  hint: { textAlign: 'center' },
  centre: { flex: 1, justifyContent: 'center' },
  trace: { textAlign: 'center', marginTop: spacing.md },
});
