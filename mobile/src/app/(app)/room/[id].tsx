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

import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/queries/keys';
import { useJoinRoom, useRoomActions } from '@/api/queries/useRoom';
import { useGiftCatalog } from '@/api/queries/useWallet';
import { ApiErrorCode, type GiftView, type JoinedRoom } from '@/api/types';
import { useFlag } from '@/config/flags';
import { useAppConfig } from '@/features/config/useAppConfig';
import { deliverGift } from '@/features/gifting/deliver';
import { GiftSheet } from '@/features/gifting/GiftSheet';
import { giftRecipients } from '@/features/gifting/recipients';
import { RoomLeaderboard } from '@/features/gifting/RoomLeaderboard';
import { RoomChat } from '@/features/room/RoomChat';
import { simulateGift } from '@/features/room/devGifts';
import type { MicRequest, SeatView } from '@/features/room/gateway';
import { isLiveKitAvailable } from '@/features/room/livekit';
import { useLiveRoom } from '@/features/room/useLiveRoom';
import { useRoomSocket } from '@/features/room/useRoomSocket';
import { useTranslation } from '@/i18n';
import { errorMessage, isErrorCode, traceReference } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, duration, radius, spacing } from '@/theme';
import { useSession } from '@/store/session';
import { preloadGiftAssets, preloadImages } from '@/visuals/assets';
import { EntryEffectLayer } from '@/visuals/EntryEffectLayer';
import { EntryEffects } from '@/visuals/entryEffects';
import { GiftAnimationLayer } from '@/visuals/GiftAnimationLayer';
import { GiftQueue } from '@/visuals/giftQueue';
import { GiftStripLayer } from '@/visuals/GiftStripLayer';
import { GiftStripLanes } from '@/visuals/giftStrips';
import { LookAvatar } from '@/visuals/LookAvatar';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Column,
  EmptyState,
  Row,
  Screen,
  SegmentedTabs,
  Sheet,
  Skeleton,
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
  const giftSheet = useRef<SheetHandle>(null);
  const boardSheet = useRef<SheetHandle>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [managing, setManaging] = useState<SeatView | null>(null);

  // Once, on mount. Not a query: it mints a short-lived credential, and a
  // refetch on focus would hand the screen a token already superseded.
  useEffect(() => {
    if (!id) return;
    join.mutate(id, { onSuccess: setJoined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // One set of lanes per room screen, created once. Gifts arrive over the
  // socket and go straight in; the layer reads them without this screen
  // re-rendering on every send.
  const [strips] = useState(() => new GiftStripLanes({ holdMs: duration.giftStripHold }));
  useEffect(() => () => strips.clear(), [strips]);

  // The full-screen layer's queue, owned here for the same reason. Every gift
  // goes into both through `deliverGift`, which dedupes the sender's own gift
  // arriving once from their send and again from the socket.
  const [animations] = useState(() => new GiftQueue());
  const receive = (gift: GiftView) => deliverGift(gift, { strips, animations });

  // Where the stage begins — the strips stack from here down. Measured rather
  // than guessed, because the header grows with the safe-area inset, the
  // connection line and any notice showing under it.
  const [stageTop, setStageTop] = useState(0);

  // Entrances by people wearing an entry effect — the server announces no one
  // else. Owned here and read by its layer, like the gifts.
  const [entries] = useState(() => new EntryEffects());

  // Coins earned for watching, said out loud the moment they land. A reward
  // discovered later in a wallet teaches nothing; one seen while watching
  // teaches that watching pays.
  const queryClient = useQueryClient();
  const [watchReward, setWatchReward] = useState<{
    coins: number;
    earnedToday: number;
    dailyCap: number;
  } | null>(null);

  const socket = useRoomSocket(joined ? id : undefined, {
    onGift: receive,
    onEntry: (user) => entries.push(user),
    onReward: (reward) => {
      haptic.success();
      setWatchReward(reward);
      void queryClient.invalidateQueries({ queryKey: queryKeys.wallet.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.rewards.all });
    },
  });

  useEffect(() => {
    if (!watchReward) return;
    const timer = setTimeout(() => setWatchReward(null), 4_000);
    return () => clearTimeout(timer);
  }, [watchReward]);

  // Cold start hides small counts everywhere, the room header included.
  const { coldStart } = useAppConfig();
  const showViewers = coldStart?.hideViewerCounts !== true;

  // Loaded on entering the room, not on opening the sheet: the sheet is the
  // moment money is spent, and a spinner there costs the gift. Icons and the
  // full-screen animations are warmed as soon as the catalog arrives — the
  // animations only on Wi-Fi, which `preloadGiftAssets` decides.
  const catalog = useGiftCatalog();
  useEffect(() => {
    if (!catalog.data) return;
    preloadImages(catalog.data.map((gift) => gift.iconAsset));
    void preloadGiftAssets(catalog.data);
  }, [catalog.data]);

  // Development only — see features/room/devGifts.ts.
  const lastDevGift = useRef<GiftView | null>(null);

  // The gateway is the live source; the join response fills the screen in the
  // moment before the socket is up.
  const room = joined?.room;
  const seats = socket.seats.length > 0 ? socket.seats : (joined?.seats ?? []);
  const isHost = room?.hostId === user?.id;
  const mySeat = seats.find((seat) => seat.userId === user?.id);

  // A single-host broadcast has NO seats, so `mySeat` is undefined for its
  // host — and driving the microphone off that alone muted them on connect
  // and then offered no control to undo it. The host can always speak in
  // their own room; a seat is how everybody else earns it.
  const canSpeak = isHost || mySeat !== undefined;

  // Who a gift can go to: the host and anyone seated, never yourself. Empty
  // for a host alone in their own room, and then there is no gift button —
  // an option that can only fail is not an option.
  const giftingEnabled = useFlag('giftingEnabled');
  const recipients = room
    ? giftRecipients({ hostId: room.hostId, hostName: room.hostName, seats, meId: user?.id })
    : [];
  const canGift = giftingEnabled && recipients.length > 0;

  function openGifts() {
    haptic.tap();
    giftSheet.current?.present();
  }

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
    void live.syncPublishing(canSpeak && !mySeat?.muted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSpeak, mySeat?.seatIndex, mySeat?.muted, live.connection]);

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

  // Joining takes a round trip. Without this the screen renders an empty
  // header, no seats and "0 watching" — which reads as a broken room rather
  // than one that has not arrived.
  if (join.isPending || !joined) {
    return (
      <Screen padded>
        <View style={styles.centre}>
          <Column gap="lg" align="center">
            <Skeleton width={96} height={96} rounding="pill" />
            <Skeleton width={180} height={20} />
            <Skeleton width={120} height={14} />
          </Column>
        </View>
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
              {showViewers && (
                <Text variant="micro" tone="secondary">
                  {t('room.viewers', { count: socket.viewers || (room?.viewers ?? 0) })}
                </Text>
              )}
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

          {__DEV__ && room && (
            <Pressable
              onPress={() => {
                const gift = simulateGift({
                  catalog: catalog.data ?? [],
                  room,
                  seats,
                  previous: lastDevGift.current,
                });
                if (!gift) return;
                lastDevGift.current = gift;
                haptic.selection();
                receive(gift);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('room.devSimulateGift')}
              hitSlop={spacing.sm}
              testID="dev-simulate-gift"
            >
              <Ionicons name="gift-outline" size={22} color={colors.text.secondary} />
            </Pressable>
          )}

          <Pressable
            onPress={() => {
              haptic.tap();
              setBoardOpen(true);
              boardSheet.current?.present();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('gifting.boardTitle')}
            hitSlop={spacing.sm}
            testID="open-leaderboard"
          >
            <Ionicons name="trophy-outline" size={22} color={colors.text.secondary} />
          </Pressable>

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

      {/*
        Everything that used to fail silently.
        · A blocked chat line cleared the composer and said nothing, so the
          sender assumed it sent and repeated it — the exact behaviour the
          filter exists to avoid.
        · A denied mic request flipped the button back with no explanation.
        · A failed kick, mute or seat change showed nothing at all.
      */}
      <MicAnswer answer={socket.micAnswer} onDismiss={socket.clearMicAnswer} />

      {watchReward && (
        <Animated.View entering={FadeIn.duration(160)} style={styles.notice}>
          <Banner
            tone="info"
            message={t('room.watchReward', {
              coins: watchReward.coins,
              earned: watchReward.earnedToday,
              cap: watchReward.dailyCap,
            })}
          />
        </Animated.View>
      )}

      <RoomNotice
        socketError={socket.lastError}
        actionError={
          actions.takeSeat.error ??
          actions.releaseSeat.error ??
          actions.muteSeat.error ??
          actions.kick.error ??
          actions.endRoom.error
        }
        onDismiss={socket.clearError}
      />

      <View
        style={styles.tabs}
        onLayout={(event) => {
          const { y, height } = event.nativeEvent.layout;
          setStageTop(y + height);
        }}
      >
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
            onGift={canGift ? openGifts : undefined}
          />
        )}
      </KeyboardAvoidingView>

      {/* The mic in three states — on a seat, waiting, or able to ask — and
          the gift button beside it. A listener in a single-host room has no
          mic to ask for, so giving is the whole bar. */}
      {tab === 'seats' && (canSpeak || room?.seatCapacity != null || canGift) && (
        <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]}>
          <Row gap="md">
            {canSpeak ? (
              <>
                <View style={styles.barMain}>
                  <Button
                    label={live.micOn ? t('room.micOn') : t('room.micOff')}
                    onPress={() => {
                      haptic.tap();
                      void live.setMicOn(!live.micOn);
                    }}
                    // The host's mute is not ours to undo. An enabled button
                    // that silently fails is worse than a disabled one.
                    disabled={mySeat?.muted === true || live.connection !== 'connected'}
                    variant={live.micOn ? 'primary' : 'secondary'}
                    size="lg"
                    fullWidth
                    testID="toggle-mic"
                  />
                </View>
                {!isHost && mySeat !== undefined && (
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
              </>
            ) : room?.seatCapacity != null && !isHost ? (
              <View style={styles.barMain}>
                <Button
                  label={socket.micPending ? t('room.handRaised') : t('room.raiseHand')}
                  onPress={askForMic}
                  disabled={socket.status !== 'live'}
                  variant={socket.micPending ? 'secondary' : 'primary'}
                  size="lg"
                  fullWidth
                  testID="raise-hand"
                />
              </View>
            ) : (
              canGift && (
                <View style={styles.barMain}>
                  <Button
                    label={t('gifting.open')}
                    onPress={openGifts}
                    size="lg"
                    fullWidth
                    testID="open-gifts"
                  />
                </View>
              )
            )}

            {canGift && (canSpeak || room?.seatCapacity != null) && (
              <Pressable
                onPress={openGifts}
                accessibilityRole="button"
                accessibilityLabel={t('gifting.open')}
                style={({ pressed }) => [styles.giftButton, pressed && styles.giftButtonPressed]}
                testID="open-gifts"
              >
                <Ionicons name="gift" size={24} color={colors.text.onBrand} />
              </Pressable>
            )}
          </Row>
        </View>
      )}

      {/* Over the stage, under the sheets. Drawn after the seats and chat so it
          sits above them; the layer itself ignores touches. */}
      <GiftStripLayer lanes={strips} top={stageTop} hostId={room?.hostId} />

      {/* Above the bottom bar, where arrivals are announced. */}
      <EntryEffectLayer effects={entries} bottom={insets.bottom + ENTRY_CLEARANCE} />

      {/* Above the strips and every piece of room chrome, below the sheets. */}
      <GiftAnimationLayer queue={animations} />

      {room && (
        <GiftSheet ref={giftSheet} roomId={room.id} recipients={recipients} onSent={receive} />
      )}

      <Sheet ref={boardSheet} title={t('gifting.boardTitle')} onDismiss={() => setBoardOpen(false)}>
        {room && <RoomLeaderboard roomId={room.id} open={boardOpen} meId={user?.id} />}
      </Sheet>

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
 * The host's answer to a raised hand.
 *
 * Both outcomes are announced. Being granted is obvious the moment the seat
 * appears, but being REFUSED is not — the button simply flipped back, and a
 * user who was refused and a user whose request never sent saw exactly the
 * same thing.
 */
function MicAnswer({
  answer,
  onDismiss,
}: {
  answer: 'granted' | 'denied' | null;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!answer) return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [answer, onDismiss]);

  if (!answer) return null;

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.notice}>
      <Banner
        message={answer === 'granted' ? t('room.micGranted') : t('room.micDenied')}
        tone={answer === 'granted' ? 'info' : 'warning'}
      />
    </Animated.View>
  );
}

/**
 * The one place a room reports that something did not work.
 *
 * Two sources, one slot. Gateway errors arrive over the socket and carry the
 * same `code` vocabulary as the REST ones, so both go through the shared error
 * mapper and neither needs its own translation table.
 *
 * Auto-dismissed, because these are transient corrections to an action just
 * taken — not system news, and a banner that has to be tapped away in the
 * middle of a live room is worse than the silence it replaced.
 */
function RoomNotice({
  socketError,
  actionError,
  onDismiss,
}: {
  socketError: { code: string; message: string } | null;
  actionError: unknown;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!socketError) return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [socketError, onDismiss]);

  const message = socketError
    ? socketError.code === 'MESSAGE_BLOCKED'
      ? t('room.chatBlocked')
      : socketError.message
    : actionError != null
      ? errorMessage(actionError)
      : null;

  if (message === null) return null;

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.notice}>
      <Banner message={message} tone="warning" />
    </Animated.View>
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
            <LookAvatar name={seat.displayName ?? '—'} size="lg" frame={seat.look?.frame} />
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

/**
 * How far above the bottom edge entrances are announced: clear of the seat bar
 * (a 56pt button and its padding) and the chat composer alike.
 */
const ENTRY_CLEARANCE = 96;

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  connection: { alignItems: 'center' },
  notice: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
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
  barMain: { flex: 1 },
  giftButton: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brand.solid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  giftButtonPressed: { backgroundColor: colors.brand.pressed },
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
