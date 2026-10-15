import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/queries/keys';
import { useRoomLeaderboard } from '@/api/queries/useGifts';
import { useJoinRoom, useRoomActions, useRoomRank } from '@/api/queries/useRoom';
import { useToggleFollow } from '@/api/queries/useSocial';
import { useGiftCatalog } from '@/api/queries/useWallet';
import type { GiftView, JoinedRoom } from '@/api/types';
import { useFlag } from '@/config/flags';
import { useAppConfig } from '@/features/config/useAppConfig';
import { deliverGift } from '@/features/gifting/deliver';
import { GiftSheet } from '@/features/gifting/GiftSheet';
import { giftRecipients } from '@/features/gifting/recipients';
import { RoomLeaderboard } from '@/features/gifting/RoomLeaderboard';
import { useTranslation } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, duration, spacing, zIndex } from '@/theme';
import { useSession } from '@/store/session';
import { Banner, Button, Column, Screen, Sheet, Text, type SheetHandle } from '@/ui';
import { preloadGiftAssets, preloadImages } from '@/visuals/assets';
import { EntryEffectLayer } from '@/visuals/EntryEffectLayer';
import { EntryEffects } from '@/visuals/entryEffects';
import { GiftAnimationLayer } from '@/visuals/GiftAnimationLayer';
import { GiftQueue } from '@/visuals/giftQueue';
import { GiftStripLayer } from '@/visuals/GiftStripLayer';
import { GiftStripLanes } from '@/visuals/giftStrips';
import { RoomBackground } from '@/visuals/RoomBackground';

import { ActivityRail } from './chrome/ActivityRail';
import { FeaturesSheet, type RoomFeature } from './chrome/FeaturesSheet';
import { MicLinkDialog, type MicLinkState } from './chrome/MicLinkDialog';
import { ProfileCardSheet, type ProfileTarget } from './chrome/ProfileCardSheet';
import { RoomChatPanel, type RoomEventLine } from './chrome/RoomChatPanel';
import { RoomComposer, type MicMode } from './chrome/RoomComposer';
import { RoomHeader } from './chrome/RoomHeader';
import { MarqueeQueue } from './chrome/marqueeQueue';
import { RoomMarquee } from './chrome/RoomMarquee';
import { buildStage, type SeatTotals, type StageOccupant } from './model';
import { RoomMediaProvider } from './media';
import { usePk } from './pk/usePk';
import { Stage } from './stage/Stage';
import { useLiveRoom } from './useLiveRoom';
import { useRoomSocket } from './useRoomSocket';

/**
 * A live room — every kind of one.
 *
 * ── The layout, and why it is fixed ─────────────────────────────────────────
 *
 *   ┌─ header ──────── host · follow · top gifters · viewers · ×  ┐
 *   ├─ activity rail ─ rank · rules · room code                   │ chrome
 *   ├─ marquee ─────── "X sent Y and won N"                       ┘
 *   ├─ STAGE ───────── seats | video | PK | solo   ← the only part that varies
 *   ├─ chat ────────── filter rail · lines · events · new-msgs pill
 *   └─ composer ────── say something · mic · camera · ⌘ · gift
 *
 * Six room types, one set of chrome, one swappable middle. That is what the
 * references do and it is why their rooms feel like one product: a user moving
 * from a voice party to a PK battle sees the same header, the same chat and the
 * same gift button in the same place.
 *
 * ── Stage and chat are both on screen, always ───────────────────────────────
 *
 * This replaces a segmented tab that showed seats OR chat. Nothing else in this
 * rewrite matters as much. A room where you cannot watch and talk at the same
 * time is a form with avatars on it, and no amount of styling fixes that.
 *
 * ── Three connections, unchanged ────────────────────────────────────────────
 *
 *   · HTTP joins once and returns a media credential.
 *   · LIVEKIT carries audio and video.
 *   · The GATEWAY pushes seats, chat, presence, gifts and the mic queue.
 */
export function RoomScreen({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const queryClient = useQueryClient();

  const [joined, setJoined] = useState<JoinedRoom | null>(null);
  const join = useJoinRoom();
  const actions = useRoomActions(roomId);
  const toggleFollow = useToggleFollow();

  const leaveSheet = useRef<SheetHandle>(null);
  const giftSheet = useRef<SheetHandle>(null);
  const boardSheet = useRef<SheetHandle>(null);
  const featuresSheet = useRef<SheetHandle>(null);
  const profileSheet = useRef<SheetHandle>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
  /**
   * `null` means "whatever the request state implies", which is the common
   * case. A value here is a dialog the person opened or dismissed themselves.
   *
   * Derived rather than mirrored: the raised hand already lives in the socket,
   * and copying it into state meant an effect writing state on every change,
   * plus two sources that could disagree about whether a request was out.
   */
  const [micDialogOverride, setMicDialogOverride] = useState<MicLinkState | 'dismissed'>(null);

  // Once, on mount. Not a query: it mints a short-lived credential, and a
  // refetch on focus would hand the screen a token already superseded.
  useEffect(() => {
    if (!roomId) return;
    join.mutate(roomId, { onSuccess: setJoined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Gift presentation layers, created once. Gifts are EVENTS: they arrive over
  // the socket and go straight into these, without the screen re-rendering.
  const [strips] = useState(() => new GiftStripLanes({ holdMs: duration.giftStripHold }));
  const [animations] = useState(() => new GiftQueue());
  const [entries] = useState(() => new EntryEffects());
  const [marquee] = useState(() => new MarqueeQueue());
  useEffect(() => () => strips.clear(), [strips]);
  // Its timer outlives the screen otherwise, and fires into an unmounted tree.
  useEffect(() => () => marquee.clear(), [marquee]);

  // The chat's event column is narrative rather than animation: it wants a
  // short history, not a queue that drains.
  const [events, setEvents] = useState<RoomEventLine[]>([]);
  const [watchReward, setWatchReward] = useState<{
    coins: number;
    earnedToday: number;
    dailyCap: number;
  } | null>(null);

  const pushEvent = useCallback((line: RoomEventLine) => {
    // Capped: a room running for three hours must not hold every arrival it
    // ever saw. The chat list is already trimmed on the same reasoning.
    setEvents((previous) => [...previous, line].slice(-120));
  }, []);

  const receive = useCallback(
    (gift: GiftView) => {
      deliverGift(gift, { strips, animations });

      const text = t('room.giftLine', {
        sender: gift.senderName ?? '—',
        gift: gift.giftName,
        quantity: gift.quantity,
        recipient: gift.recipientName ?? '—',
      });
      pushEvent({ id: `gift-${gift.id}`, kind: 'gift', text });

      // Only the loud ones take the marquee. A room where every 20-coin Heart
      // scrolls a banner has a banner nobody reads.
      if (gift.tier >= 3) {
        marquee.push({
          id: `m-${gift.id}`,
          // Tier 5 crosses every room on the platform; tiers 3 and 4 belong to
          // this one. Same strip, different fill.
          kind: gift.tier >= 5 ? 'global' : 'gift',
          text,
          // What the queue sheds first when a storm backs it up.
          weight: gift.coinPrice * gift.quantity,
        });
      }
    },
    [strips, animations, marquee, pushEvent, t],
  );

  // Fetched once on joining — a viewer arriving mid-battle needs the bar
  // immediately — and pushed thereafter, one message per gift to either host.
  const { pk, onPushed: onPk } = usePk(roomId, joined !== null);

  const socket = useRoomSocket(joined ? roomId : undefined, {
    onGift: receive,
    onPk,
    /**
     * A Rocket or Galaxy landed in somebody else's room.
     *
     * It takes the marquee as a `global` item and nothing else — no animation,
     * no strip. Those are for gifts sent HERE; playing a full-screen Galaxy
     * over a room it was not sent in would be lying about what just happened.
     *
     * Dropped when it is our own room, because the ordinary `gift` message has
     * already arrived and played it properly.
     */
    onGlobalGift: (gift, fromRoomId) => {
      if (fromRoomId === roomId) return;
      marquee.push({
        id: `global-${gift.id}`,
        kind: 'global',
        text: t('room.globalGiftLine', {
          sender: gift.senderName ?? '—',
          gift: gift.giftName,
          recipient: gift.recipientName ?? '—',
        }),
        weight: gift.coinPrice * gift.quantity,
      });
    },
    onEntry: (entrant) => {
      entries.push(entrant);
      pushEvent({
        id: `entry-${entrant.userId}-${Date.now()}`,
        kind: 'entry',
        text: t('room.entryLine', { name: entrant.name ?? '—' }),
      });
    },
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

  // A rejected action — a seat already taken, a blocked chat line — says what
  // happened and then gets out of the way. There is nothing to retry from
  // here: the tap that failed is gone, and a banner that stays until dismissed
  // is a banner covering the chat for the rest of the broadcast.
  useEffect(() => {
    if (!socket.lastError) return;
    haptic.error();
    const timer = setTimeout(socket.clearError, 5_000);
    return () => clearTimeout(timer);
  }, [socket.lastError, socket.clearError]);

  // ── Room state ──────────────────────────────────────────────────────────
  //
  // The gateway is the live source; the join response fills the screen in the
  // moment before the socket is up.
  const room = joined?.room;
  // Memoised because the stage is built from it: a fresh `[]` on every render
  // would rebuild the whole stage model on every chat line, and with it every
  // seat tile in a twenty-seat room.
  const seats = useMemo(
    () => (socket.seats.length > 0 ? socket.seats : (joined?.seats ?? [])),
    [socket.seats, joined?.seats],
  );
  const isHost = room?.hostId === user?.id;
  const mySeat = seats.find((seat) => seat.userId === user?.id);
  const canSpeak = isHost || mySeat !== undefined;

  const videoEnabled = useFlag('videoRoomsEnabled');
  const giftingEnabled = useFlag('giftingEnabled');
  const { coldStart } = useAppConfig();

  const stage = useMemo(
    () => buildStage({ room, seats, pk, videoEnabled }),
    [room, seats, pk, videoEnabled],
  );

  // Polled while the room is open rather than only while the board sheet is:
  // the header rail and every seat's counter read from it, so it is room
  // chrome now, not sheet content.
  const board = useRoomLeaderboard(roomId, joined !== null);

  // The second line of every reference room, and the reason the rail exists: a
  // host who can see they are 18% short of the next place has something to ask
  // the room for. Polled at the server's own rollup cadence, never faster.
  const rank = useRoomRank(roomId, joined !== null);
  const totals: SeatTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of board.data ?? []) map.set(entry.userId, entry.coins);
    return map;
  }, [board.data]);

  const recipients = room
    ? giftRecipients({ hostId: room.hostId, hostName: room.hostName, seats, meId: user?.id })
    : [];
  const canGift = giftingEnabled && recipients.length > 0;

  const live = useLiveRoom({
    url: joined?.rtc.url ?? null,
    token: joined?.rtc.token ?? null,
    publish: joined?.canPublish ?? false,
    publishVideo: (room?.video ?? false) && videoEnabled && (joined?.canPublish ?? false),
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

  // Loaded on entering the room, not on opening the sheet: the sheet is the
  // moment money is spent, and a spinner there costs the gift.
  const catalog = useGiftCatalog();
  useEffect(() => {
    if (!catalog.data) return;
    preloadImages(catalog.data.map((gift) => gift.iconAsset));
    void preloadGiftAssets(catalog.data);
  }, [catalog.data]);

  // ── Actions ─────────────────────────────────────────────────────────────

  function openProfile(occupant: StageOccupant) {
    haptic.selection();
    setProfileTarget({
      userId: occupant.userId,
      displayName: occupant.displayName,
      roomCoins: totals.get(occupant.userId),
      manageable: isHost && occupant.userId !== user?.id,
      seatIndex: occupant.seatIndex >= 0 ? occupant.seatIndex : undefined,
      muted: occupant.muted,
    });
    profileSheet.current?.present();
  }

  function takeOrAsk(seatIndex: number) {
    haptic.tap();
    // A host takes their own seat directly. Everybody else asks, and holding a
    // seat already makes an empty tile inert.
    if (isHost) {
      actions.takeSeat.mutate(seatIndex);
      return;
    }
    if (mySeat !== undefined) return;
    // Clearing the override covers both branches: re-opening the dialog for a
    // request already out, and forgetting an earlier dismissal before a new one.
    setMicDialogOverride(null);
    if (!socket.micPending) socket.requestMic();
  }

  function onMicPress() {
    haptic.tap();
    if (canSpeak) {
      void live.setMicOn(!live.micOn);
      return;
    }
    setMicDialogOverride(null);
    if (!socket.micPending) socket.requestMic();
  }

  function onFeature(feature: RoomFeature) {
    featuresSheet.current?.dismiss();
    switch (feature) {
      case 'leaderboard':
        setBoardOpen(true);
        boardSheet.current?.present();
        break;
      case 'rewards':
        router.push('/rewards');
        break;
      case 'store':
        router.push('/wallet');
        break;
      case 'cosmetics':
        router.push('/store');
        break;
      case 'report':
        // Reporting lives on the person, not the room — the profile screen
        // owns the flow and the block that usually follows it.
        if (room) router.push(`/user/${room.hostId}`);
        break;
      case 'rules':
        router.push('/legal/guidelines');
        break;
      // 'share' and 'minimise' are disabled in the sheet and cannot arrive.
      default:
        break;
    }
  }

  // Asked, and then answered. A raised hand shows the waiting dialog unless it
  // has been dismissed; once the host answers, `micPending` clears and the
  // dialog goes with it, so the next request opens a fresh one.
  const micDialog: MicLinkState =
    micDialogOverride === 'dismissed'
      ? null
      : (micDialogOverride ?? (socket.micPending ? 'waiting' : null));

  const micMode: MicMode = canSpeak
    ? 'live'
    : socket.micPending
      ? 'pending'
      : room?.seatCapacity != null
        ? 'request'
        : 'none';

  return (
    <Screen padded={false} edges={[]}>
      <RoomBackground path={room?.backgroundPath} />

      <RoomMediaProvider videoTracks={live.videoTracks}>
        {/* ── Chrome, top ─────────────────────────────────────────────── */}
        <View style={[styles.chrome, { paddingTop: insets.top + spacing.xs }]}>
          <RoomHeader
            hostId={room?.hostId ?? ''}
            hostName={room?.hostName ?? null}
            hostAvatar={null}
            hostCoins={room ? totals.get(room.hostId) : undefined}
            viewers={socket.viewers || (room?.viewers ?? 0)}
            showViewers={coldStart?.hideViewerCounts !== true}
            following={false}
            followPending={toggleFollow.isPending}
            contributors={board.data ?? []}
            onFollow={() => room && toggleFollow.mutate({ userId: room.hostId, following: false })}
            onHostPress={() => {
              if (stage.kind === 'seats' && stage.host) openProfile(stage.host);
              else if (room) {
                openProfile({
                  seatIndex: -1,
                  userId: room.hostId,
                  displayName: room.hostName,
                  muted: false,
                  look: null,
                  isHost: true,
                });
              }
            }}
            onContributorsPress={() => {
              setBoardOpen(true);
              boardSheet.current?.present();
            }}
            onClose={() => leaveSheet.current?.present()}
          />

          <ActivityRail
            rank={
              rank.data === null || rank.data === undefined
                ? null
                : {
                    board: t('room.boardHour'),
                    position: rank.data.position,
                    progress: rank.data.progress,
                  }
            }
            // The SHORT number, not a sliced uuid. `publicId` is what a host
            // reads out and what somebody types to find the room again.
            roomCode={room === undefined ? '—' : String(room.publicId)}
            onRulesPress={() => router.push('/legal/guidelines')}
            onRankPress={() => {
              setBoardOpen(true);
              boardSheet.current?.present();
            }}
          />

          <RoomMarquee queue={marquee} />
        </View>

        {/* ── Stage ───────────────────────────────────────────────────── */}
        <View style={styles.stage}>
          <Stage
            model={stage}
            speaking={live.speaking}
            totals={totals}
            onOccupantPress={openProfile}
            onVacancyPress={takeOrAsk}
          />
        </View>

        {/* Transient notices, between the stage and the chat — where the eye
            already is after a gift lands. */}
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

        {socket.lastError && (
          <Animated.View entering={FadeIn.duration(160)} style={styles.notice}>
            <Banner message={socket.lastError.message} />
          </Animated.View>
        )}

        {/* ── Chat and composer ───────────────────────────────────────── */}
        <KeyboardAvoidingView behavior="padding" style={styles.lower}>
          <RoomChatPanel
            chat={socket.chat}
            events={events}
            meId={user?.id}
            notice={t('room.safetyNotice')}
            onNamePress={(userId, displayName) =>
              openProfile({
                seatIndex: -1,
                userId,
                displayName,
                muted: false,
                look: null,
                isHost: false,
              })
            }
          />

          <View style={{ paddingBottom: insets.bottom + spacing.sm }}>
            <RoomComposer
              canSend={socket.status === 'live'}
              canGift={canGift}
              micMode={micMode}
              micOn={live.micOn}
              micBlocked={mySeat?.muted === true}
              showCamera={canSpeak && (room?.video ?? false) && videoEnabled}
              cameraOn={live.videoTracks.has(user?.id ?? '')}
              onSend={socket.sendChat}
              onMicPress={onMicPress}
              onCameraPress={() => void live.setCameraOn(!live.videoTracks.has(user?.id ?? ''))}
              onFeaturesPress={() => featuresSheet.current?.present()}
              onGiftPress={() => giftSheet.current?.present()}
            />
          </View>
        </KeyboardAvoidingView>

        {/* ── Layers: above the room, below the sheets ────────────────── */}
        <GiftStripLayer lanes={strips} top={insets.top + 72} hostId={room?.hostId} />
        <EntryEffectLayer effects={entries} bottom={insets.bottom + 96} />
        <GiftAnimationLayer queue={animations} />
      </RoomMediaProvider>

      {/* ── Sheets and dialogs ─────────────────────────────────────────── */}
      {room && (
        <GiftSheet ref={giftSheet} roomId={room.id} recipients={recipients} onSent={receive} />
      )}

      <FeaturesSheet ref={featuresSheet} onSelect={onFeature} />

      <ProfileCardSheet
        ref={profileSheet}
        target={profileTarget}
        isSelf={profileTarget?.userId === user?.id}
        canGift={canGift}
        onGift={() => {
          profileSheet.current?.dismiss();
          giftSheet.current?.present();
        }}
        onOpenProfile={(userId) => {
          profileSheet.current?.dismiss();
          router.push(`/user/${userId}`);
        }}
        onMute={(userId, muted) => actions.muteSeat.mutate({ userId, muted })}
        onKick={(userId) => {
          actions.kick.mutate(userId);
          profileSheet.current?.dismiss();
        }}
        onRemoveFromSeat={(userId) => {
          actions.releaseSeat.mutate(userId);
          profileSheet.current?.dismiss();
        }}
      />

      <Sheet ref={boardSheet} title={t('gifting.boardTitle')} onDismiss={() => setBoardOpen(false)}>
        {room && <RoomLeaderboard roomId={room.id} open={boardOpen} meId={user?.id} />}
      </Sheet>

      <Sheet ref={leaveSheet} title={isHost ? t('room.endTitle') : t('room.leaveTitle')}>
        <Column gap="md">
          {isHost && (
            <Text variant="body" tone="secondary">
              {t('room.endBody')}
            </Text>
          )}
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

      <MicLinkDialog
        state={micDialog}
        hostName={room?.hostName ?? null}
        hostAvatar={null}
        followPending={toggleFollow.isPending}
        onKeepWaiting={() => setMicDialogOverride('dismissed')}
        onWithdraw={() => {
          socket.cancelMic();
          setMicDialogOverride(null);
        }}
        onFollow={() => {
          if (room) toggleFollow.mutate({ userId: room.hostId, following: false });
          setMicDialogOverride('dismissed');
        }}
        onDismiss={() => setMicDialogOverride('dismissed')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chrome: {
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    zIndex: zIndex.roomChrome,
  },
  /**
   * The stage takes 42% of the screen and the chat takes the rest.
   *
   * A fixed share rather than `flex: 1` on both, because the two want opposite
   * things: a twenty-seat grid would eat the whole screen given the chance, and
   * a solo audio room would leave the chat stranded at the bottom. 42% is where
   * a 4×5 seat grid fits without scrolling and eight chat lines are still
   * readable underneath — which is the balance every reference strikes.
   */
  stage: { height: '42%' },
  notice: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  lower: { flex: 1, backgroundColor: colors.bg.baseTransparent },
});
