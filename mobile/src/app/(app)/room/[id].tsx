import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useJoinRoom, useRoomActions } from '@/api/queries/useRoom';
import { ApiErrorCode, type JoinedRoom } from '@/api/types';
import { RoomChat } from '@/features/room/RoomChat';
import type { MicRequest, SeatView } from '@/features/room/gateway';
import { isLiveKitAvailable } from '@/features/room/livekit';
import { useLiveRoom } from '@/features/room/useLiveRoom';
import { useRoomSocket } from '@/features/room/useRoomSocket';
import { useTranslation } from '@/i18n';
import { errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { useSession } from '@/store/session';
import {
  Avatar,
  Badge,
  Button,
  Column,
  EmptyState,
  Row,
  Screen,
  SegmentedTabs,
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
 * ── Three connections, one screen ────────────────────────────────────────────
 *
 *   · HTTP joins the room and returns a media credential. Once, on mount.
 *   · LIVEKIT carries the audio.
 *   · The GATEWAY carries everything else — the seat map, chat, presence and
 *     the mic queue — and it PUSHES. This screen used to poll the seat map
 *     every three seconds; that is gone, and with it twenty requests a minute
 *     from every viewer.
 */
export default function RoomScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();

  const [joined, setJoined] = useState<JoinedRoom | null>(null);
  const [tab, setTab] = useState<'seats' | 'chat'>('seats');
  const join = useJoinRoom();
  const actions = useRoomActions(id);

  const leaveSheet = useRef<SheetHandle>(null);
  const manageSheet = useRef<SheetHandle>(null);
  const queueSheet = useRef<SheetHandle>(null);
  const [managing, setManaging] = useState<SeatView | null>(null);

  // Once, on mount. Not a query: it mints a short-lived credential, and a
  // refetch on focus would hand the screen a token already superseded.
  useEffect(() => {
    if (!id) return;
    join.mutate(id, { onSuccess: setJoined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const socket = useRoomSocket(joined ? id : undefined);

  // The gateway is the live source; the join response fills the screen in the
  // moment before the socket is up.
  const room = joined?.room;
  const seats = socket.seats.length > 0 ? socket.seats : (joined?.seats ?? []);
  const isHost = room?.hostId === user?.id;
  const mySeat = seats.find((seat) => seat.userId === user?.id);

  const live = useLiveRoom({
    url: joined?.rtc.url ?? null,
    token: joined?.rtc.token ?? null,
    publish: joined?.canPublish ?? false,
  });

  // The host can take a mic away at any moment and LiveKit unpublishes the
  // track without telling this screen. This reconciles our microphone with
  // whatever grant we actually hold now.
  useEffect(() => {
    if (live.connection !== 'connected') return;
    void live.syncPublishing(mySeat !== undefined && !mySeat.muted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySeat?.seatIndex, mySeat?.muted, live.connection]);

  // The host ended it. Nothing here is usable any more.
  useEffect(() => {
    if (!socket.ended) return;
    haptic.error();
    router.back();
  }, [socket.ended]);

  function askForMic() {
    haptic.tap();
    if (socket.micPending) socket.cancelMic();
    else socket.requestMic();
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
                {t('room.viewers', { count: socket.viewers || (room?.viewers ?? 0) })}
              </Text>
            </Row>
          </Column>

          {/* Host only, and only when somebody is waiting. A raised hand
              nobody sees is the same as no queue at all. */}
          {isHost && socket.micQueue.length > 0 && (
            <Pressable
              onPress={() => {
                haptic.tap();
                queueSheet.current?.present();
              }}
              accessibilityRole="button"
              accessibilityLabel={t('room.queueBadge', { count: socket.micQueue.length })}
              hitSlop={spacing.sm}
              style={styles.queueButton}
              testID="open-mic-queue"
            >
              <Ionicons name="hand-right" size={16} color={colors.text.onBrand} />
              <Text variant="micro" style={styles.queueCount}>
                {socket.micQueue.length}
              </Text>
            </Pressable>
          )}

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

        <ConnectionLine media={live.connection} socket={socket.status} />
      </LinearGradient>

      <View style={styles.tabs}>
        <SegmentedTabs
          options={[
            { value: 'seats', label: t('room.seatsTab') },
            { value: 'chat', label: t('room.chatTab') },
          ]}
          value={tab}
          onChange={(next) => {
            haptic.selection();
            setTab(next as 'seats' | 'chat');
          }}
        />
      </View>

      <KeyboardAvoidingView behavior="padding" style={styles.body}>
        {tab === 'seats' ? (
          room?.seatCapacity != null ? (
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
                        // The host takes their own seat directly — they do not
                        // queue for permission in their own room. This is a
                        // safety net rather than a normal path: seat 0 is
                        // created with the room and only released when it
                        // ends, so a host without one means something went
                        // wrong, and being unable to speak in your own
                        // broadcast is not a state to be stuck in.
                        if (isHost) {
                          haptic.tap();
                          actions.takeSeat.mutate(index);
                          return;
                        }
                        // Everyone else asks. Holding a seat already makes an
                        // empty tile inert.
                        if (mySeat !== undefined) return;
                        askForMic();
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
            </Animated.View>
          )
        ) : (
          <RoomChat
            lines={socket.chat}
            meId={user?.id}
            canSend={socket.status === 'live'}
            onSend={socket.sendChat}
          />
        )}
      </KeyboardAvoidingView>

      {/* Three states: on a seat, waiting, or able to ask. */}
      {tab === 'seats' && (
        <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]}>
          {mySeat !== undefined ? (
            <Row gap="md">
              <Button
                label={live.micOn ? t('room.micOn') : t('room.micOff')}
                onPress={() => {
                  haptic.tap();
                  void live.setMicOn(!live.micOn);
                }}
                // The host's mute is not ours to undo. An enabled button that
                // silently fails is worse than a disabled one.
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
            room?.seatCapacity != null &&
            !isHost && (
              <Button
                label={socket.micPending ? t('room.handRaised') : t('room.raiseHand')}
                onPress={askForMic}
                disabled={socket.status !== 'live'}
                variant={socket.micPending ? 'secondary' : 'primary'}
                size="lg"
                fullWidth
                testID="raise-hand"
              />
            )
          )}
        </View>
      )}

      <Sheet ref={leaveSheet} title={isHost ? t('room.endTitle') : t('room.leaveTitle')}>
        <Text variant="body" tone="secondary">
          {isHost ? t('room.endBody') : ''}
        </Text>
        <Column gap="sm">
          <Button
            label={isHost ? t('room.end') : t('room.leave')}
            onPress={() => {
              if (isHost) {
                actions.endRoom.mutate(undefined, { onSuccess: () => router.back() });
                return;
              }
              haptic.selection();
              router.back();
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

      <Sheet ref={queueSheet} title={t('room.queueTitle')}>
        {socket.micQueue.length === 0 ? (
          <Text variant="body" tone="secondary">
            {t('room.queueEmpty')}
          </Text>
        ) : (
          <Column gap="md">
            {socket.micQueue.map((request) => (
              <QueueRow
                key={request.userId}
                request={request}
                approveLabel={t('room.approve')}
                denyLabel={t('room.deny')}
                onResolve={(approve) => {
                  haptic.tap();
                  socket.resolveMic(request.userId, approve);
                }}
              />
            ))}
          </Column>
        )}
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
 * One line for two connections.
 *
 * Shown only when something is wrong. A permanent "connected" badge is noise —
 * working audio and arriving chat already say so. The MEDIA state wins when
 * both are unhappy, because silence is what a user notices first.
 */
function ConnectionLine({
  media,
  socket,
}: {
  media: ReturnType<typeof useLiveRoom>['connection'];
  socket: ReturnType<typeof useRoomSocket>['status'];
}) {
  const { t } = useTranslation();

  const label =
    media === 'failed'
      ? t('room.connectFailed')
      : media === 'reconnecting'
        ? t('room.reconnecting')
        : media === 'connecting'
          ? t('room.connecting')
          : socket !== 'live'
            ? t('room.chatOffline')
            : null;

  if (label === null) return null;

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.connection}>
      <Text variant="micro" tone={media === 'failed' ? 'danger' : 'secondary'}>
        {label}
      </Text>
    </Animated.View>
  );
}

function QueueRow({
  request,
  approveLabel,
  denyLabel,
  onResolve,
}: {
  request: MicRequest;
  approveLabel: string;
  denyLabel: string;
  onResolve: (approve: boolean) => void;
}) {
  return (
    <Row gap="md">
      <Avatar name={request.name ?? '—'} size="sm" />
      <Text variant="body" numberOfLines={1} style={styles.queueName}>
        {request.name ?? '—'}
      </Text>
      <Button label={denyLabel} onPress={() => onResolve(false)} variant="ghost" size="sm" />
      <Button label={approveLabel} onPress={() => onResolve(true)} size="sm" />
    </Row>
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
  seat?: SeatView;
  hostId: string;
  speaking: boolean;
  emptyLabel: string;
  hostLabel: string;
  onPress: () => void;
}) {
  // A slow pulse rather than a hard on/off: audio levels flicker, and a binary
  // indicator would strobe.
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
  queueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.accent,
  },
  queueCount: { color: colors.text.onBrand },
  queueName: { flex: 1 },
  tabs: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  body: { flex: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
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
  bar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  centre: { flex: 1, justifyContent: 'center' },
  trace: { textAlign: 'center', marginTop: spacing.md },
});
