// The media connection, as a hook.
//
// Wraps `livekit-client`'s Room directly rather than using the SDK's React
// components. The same reasoning that decided against a UI component library:
// this app's room is heavily branded and the component layer would be fought,
// not used. What is actually needed is four values and three actions, and
// those are cheaper to expose than to work around.
//
// The Room object lives in a ref, not in state. It is mutable, long-lived and
// emits constantly; putting it in state would re-render the screen on every
// audio-level tick.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { reportError } from '@/lib/reporting';
import {
  ensureLiveKitReady,
  isLiveKitAvailable,
  startAudioSession,
  stopAudioSession,
} from './livekit';

export type RoomConnection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface LiveRoomState {
  connection: RoomConnection;
  /** User ids currently making sound. Drives the speaking ring on a seat. */
  speaking: string[];
  /** Whether OUR microphone is publishing. False for a listener, always. */
  micOn: boolean;
  /** Media-server participant count. Falls back to the API's number until connected. */
  participants: number;
  /**
   * Published camera tracks, by user id.
   *
   * A MAP rather than a list because every consumer asks the same question —
   * "does this person have video?" — while drawing a tile for one specific
   * participant. The values are LiveKit `VideoTrack`s, typed loosely so this
   * module stays the only one that needs the SDK's types; `RemoteVideo` is the
   * only thing that renders one.
   */
  videoTracks: ReadonlyMap<string, unknown>;
}

interface Options {
  url: string | null;
  token: string | null;
  /** Enable the mic on connect. Only ever true when the server granted a seat. */
  publish: boolean;
  /**
   * Also publish the camera.
   *
   * Separate from `publish` because they are different permissions to the user:
   * agreeing to talk is not agreeing to be seen. A video room asks for both, a
   * voice room never asks for the camera, and a guest on a video stage can be
   * on mic with their camera off.
   */
  publishVideo?: boolean;
}

/**
 * Connects to a media room for as long as the screen is mounted.
 *
 * Reconnection is LiveKit's own — it retries a dropped signal internally and
 * reports `reconnecting`, which is why there is no retry loop here. Writing one
 * would fight the SDK and produce two connections racing to publish.
 */
export function useLiveRoom({ url, token, publish, publishVideo = false }: Options) {
  const roomRef = useRef<import('livekit-client').Room | null>(null);
  const [state, setState] = useState<LiveRoomState>({
    connection: 'idle',
    speaking: [],
    micOn: false,
    participants: 0,
    videoTracks: new Map(),
  });

  // DERIVED, not written from the effect. A build without the native module
  // can never connect, and that is knowable at render — pushing it through
  // setState would be a cascading render for a value that never changes.
  const available = isLiveKitAvailable();

  useEffect(() => {
    if (!url || !token) return;
    if (!ensureLiveKitReady()) return;

    let cancelled = false;
    // Required lazily, alongside the native module it depends on. A static
    // import would run before `registerGlobals()` has installed the WebRTC
    // polyfills that livekit-client expects to already exist.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const livekit = require('livekit-client') as typeof import('livekit-client');
    const { Room, RoomEvent, ConnectionState } = livekit;

    const room = new Room({
      // `adaptiveStream` pauses a subscribed video track when nothing is
      // rendering it, which is exactly right for a room where the stage swaps
      // between a seat grid and two tiles: the seats subscribe to nobody's
      // camera, and the bandwidth goes with them.
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const sync = () => {
      if (cancelled) return;

      // Rebuilt rather than patched. A track can appear, be replaced or vanish
      // on reconnect, and reconciling those events individually is how a tile
      // ends up rendering a track that has already been closed.
      const videoTracks = new Map<string, unknown>();
      const collect = (participant: {
        identity: string;
        videoTrackPublications: Map<string, { track?: unknown; isSubscribed?: boolean }>;
      }) => {
        for (const publication of participant.videoTrackPublications.values()) {
          if (publication.track) videoTracks.set(participant.identity, publication.track);
        }
      };
      collect(room.localParticipant as never);
      for (const participant of room.remoteParticipants.values()) collect(participant as never);

      setState({
        connection: mapConnection(room.state, ConnectionState),
        speaking: room.activeSpeakers.map((p) => p.identity),
        micOn: room.localParticipant.isMicrophoneEnabled,
        // +1 for ourselves: remoteParticipants excludes the local one, and a
        // room that says "0 here" while you are standing in it reads as broken.
        participants: room.remoteParticipants.size + 1,
        videoTracks,
      });
    };

    room
      .on(RoomEvent.ConnectionStateChanged, sync)
      .on(RoomEvent.ActiveSpeakersChanged, sync)
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.LocalTrackPublished, sync)
      .on(RoomEvent.LocalTrackUnpublished, sync)
      // Video arrives and leaves independently of everything above: a host
      // turns their camera on mid-broadcast, a guest's connection drops the
      // video layer but keeps audio. Without these the tile never updates.
      .on(RoomEvent.TrackSubscribed, sync)
      .on(RoomEvent.TrackUnsubscribed, sync)
      .on(RoomEvent.TrackPublished, sync)
      .on(RoomEvent.TrackUnpublished, sync);

    (async () => {
      setState((s) => ({ ...s, connection: 'connecting' }));
      await startAudioSession();

      try {
        await room.connect(url, token);
        if (cancelled) return;

        // Only after connecting, and only when the SERVER said so. Asking for
        // the microphone as a listener would prompt for a permission the user
        // cannot use and we would have to refuse anyway.
        if (publish) await room.localParticipant.setMicrophoneEnabled(true);
        // The camera is asked for second and allowed to fail on its own. A
        // denied camera permission must leave someone on the mic, not drop
        // them out of the room they were granted a seat in.
        if (publish && publishVideo) {
          try {
            await room.localParticipant.setCameraEnabled(true);
          } catch (error) {
            reportError(error, { code: 'CAMERA_ENABLE_FAILED', screen: 'room' });
          }
        }
        sync();
      } catch (error) {
        if (cancelled) return;
        reportError(error, { code: 'ROOM_CONNECT_FAILED', screen: 'room' });
        setState((s) => ({ ...s, connection: 'failed' }));
      }
    })();

    return () => {
      cancelled = true;
      roomRef.current = null;
      // Disconnect BEFORE releasing the audio session, or the OS keeps voice
      // routing while a track is still open and the next sound in the app
      // comes out of the earpiece.
      void room.disconnect().finally(() => void stopAudioSession());
    };
  }, [url, token, publish, publishVideo]);

  /**
   * Leaves the room when the app is backgrounded.
   *
   * Deliberate, and not merely polite. A phone in a pocket with an open
   * microphone is broadcasting whatever it can hear to a room of strangers,
   * and the user has no way to know. Android will also kill the connection
   * eventually anyway — doing it ourselves means it happens predictably.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') void roomRef.current?.localParticipant.setMicrophoneEnabled(false);
    });
    return () => sub.remove();
  }, []);

  /** Mutes or unmutes our own microphone. A no-op without a seat. */
  const setMicOn = useCallback(async (on: boolean) => {
    const room = roomRef.current;
    if (!room) return;

    try {
      await room.localParticipant.setMicrophoneEnabled(on);
      setState((s) => ({ ...s, micOn: room.localParticipant.isMicrophoneEnabled }));
    } catch (error) {
      // Almost always a denied microphone permission. Reported rather than
      // thrown: the screen stays usable as a listener.
      reportError(error, { code: 'MIC_TOGGLE_FAILED', screen: 'room' });
      setState((s) => ({ ...s, micOn: false }));
    }
  }, []);

  /** Turns our own camera on or off. A no-op without a seat. */
  const setCameraOn = useCallback(async (on: boolean) => {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setCameraEnabled(on);
    } catch (error) {
      reportError(error, { code: 'CAMERA_TOGGLE_FAILED', screen: 'room' });
    }
  }, []);

  /** Front/back. Silently ignored when there is no camera track to switch. */
  const flipCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      const publication = [...room.localParticipant.videoTrackPublications.values()][0];
      const track = publication?.videoTrack;
      if (track && 'restartTrack' in track) {
        const current = (
          track as { mediaStreamTrack?: { getSettings?: () => { facingMode?: string } } }
        ).mediaStreamTrack?.getSettings?.().facingMode;
        await (track as { restartTrack: (o: unknown) => Promise<void> }).restartTrack({
          facingMode: current === 'environment' ? 'user' : 'environment',
        });
      }
    } catch (error) {
      reportError(error, { code: 'CAMERA_FLIP_FAILED', screen: 'room' });
    }
  }, []);

  /**
   * Publishing state is the SERVER's decision, and it changes underneath us —
   * the host can revoke a seat at any moment, and LiveKit unpublishes the track
   * without asking. This reconciles our microphone with whatever grant we now
   * hold, and is called when the seat map changes.
   */
  const syncPublishing = useCallback(
    async (shouldPublish: boolean) => {
      if (!roomRef.current) return;
      if (shouldPublish === roomRef.current.localParticipant.isMicrophoneEnabled) return;
      await setMicOn(shouldPublish);
    },
    [setMicOn],
  );

  return {
    ...state,
    // The one place the derived value is folded in, so no caller has to
    // remember to check availability separately from connection state.
    connection: available ? state.connection : ('failed' as const),
    setMicOn,
    setCameraOn,
    flipCamera,
    syncPublishing,
  };
}

function mapConnection(
  state: import('livekit-client').ConnectionState,
  ConnectionState: typeof import('livekit-client').ConnectionState,
): RoomConnection {
  switch (state) {
    case ConnectionState.Connected:
      return 'connected';
    case ConnectionState.Connecting:
      return 'connecting';
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return 'reconnecting';
    default:
      return 'idle';
  }
}
