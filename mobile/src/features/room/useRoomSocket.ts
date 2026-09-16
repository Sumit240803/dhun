// The gateway, as a hook.
//
// Owns the socket for as long as the room screen is mounted, and turns the
// message stream into the four pieces of state the screen renders. The socket
// itself lives in a ref — it is mutable and long-lived, and putting it in state
// would reconnect on every render.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GiftView } from '@/api/types';
import { tokenStorage } from '@/features/auth/storage';
import {
  RoomSocket,
  type ChatLine,
  type EntryView,
  type MicRequest,
  type SeatView,
  type SocketStatus,
} from './gateway';

/** Trimmed on arrival. A room running for hours would otherwise grow forever. */
const MAX_LINES = 200;

export interface RoomSocketState {
  status: SocketStatus;
  seats: SeatView[];
  viewers: number;
  chat: ChatLine[];
  /** Populated only for the host — the server sends it to nobody else. */
  micQueue: MicRequest[];
  /** Our own raised hand, cleared when the host answers. */
  micPending: boolean;
  /**
   * The host's answer, once.
   *
   * Held separately from `micPending` because clearing that flag is silent —
   * the button flipped back from "waiting" to "ask" and nothing said whether
   * the host had refused or the request had simply failed to send.
   */
  micAnswer: 'granted' | 'denied' | null;
  /** The host ended it. The screen leaves. */
  ended: boolean;
  /** The last rejected action, for a one-line message under the composer. */
  lastError: { code: string; message: string } | null;
}

interface Options {
  /**
   * A gift arrived.
   *
   * A callback rather than state, deliberately. Gifts are EVENTS — a strip
   * takes one and animates it — not a value the screen renders from. Holding
   * them in state would mean an array growing for the whole broadcast and a
   * re-render of the entire room on every single send.
   */
  onGift?: (gift: GiftView) => void;
  /** An entrance to announce. An event too, for the same reason as a gift. */
  onEntry?: (user: EntryView) => void;
  /** Coins just earned for watching. */
  onReward?: (reward: { coins: number; earnedToday: number; dailyCap: number }) => void;
}

export function useRoomSocket(roomId: string | undefined, options: Options = {}) {
  const socketRef = useRef<RoomSocket | null>(null);

  // Held in a ref so a new callback identity does not tear down the socket.
  // Without this, an inline arrow at the call site reconnects on every render.
  const onGiftRef = useRef(options.onGift);
  const onEntryRef = useRef(options.onEntry);
  const onRewardRef = useRef(options.onReward);
  useEffect(() => {
    onGiftRef.current = options.onGift;
    onEntryRef.current = options.onEntry;
    onRewardRef.current = options.onReward;
  });
  const [state, setState] = useState<RoomSocketState>({
    status: 'connecting',
    seats: [],
    viewers: 0,
    chat: [],
    micQueue: [],
    micPending: false,
    micAnswer: null,
    ended: false,
    lastError: null,
  });

  useEffect(() => {
    if (!roomId) return;

    const socket = new RoomSocket({
      roomId,
      getToken: () => tokenStorage.getAccess(),
      onStatus: (status) => setState((s) => ({ ...s, status })),
      onMessage: (message) => {
        if (message.t === 'gift') {
          onGiftRef.current?.(message.gift);
          return;
        }
        if (message.t === 'entry') {
          onEntryRef.current?.(message.user);
          return;
        }
        if (message.t === 'reward') {
          onRewardRef.current?.(message);
          return;
        }
        setState((s) => {
          switch (message.t) {
            case 'joined':
              // A REPLACEMENT, not a merge. This arrives on every reconnect
              // too, and it is the server's view of the room — merging would
              // leave stale seats and duplicate history behind after an outage.
              return {
                ...s,
                seats: message.seats,
                viewers: message.viewers,
                chat: message.history,
                micQueue: message.micQueue ?? [],
              };

            case 'chat':
              return { ...s, chat: [...s.chat, message.line].slice(-MAX_LINES) };

            case 'seats':
              return { ...s, seats: message.seats };

            case 'presence':
              return { ...s, viewers: message.viewers };

            case 'mic:queue':
              return { ...s, micQueue: message.requests };

            case 'mic:resolved':
              return {
                ...s,
                micPending: false,
                micAnswer: message.approved ? 'granted' : 'denied',
              };

            case 'room:ended':
              return { ...s, ended: true };

            case 'error':
              return { ...s, lastError: { code: message.code, message: message.message } };

            default:
              return s;
          }
        });
      },
    });

    socketRef.current = socket;
    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [roomId]);

  const sendChat = useCallback(
    (body: string) => {
      const trimmed = body.trim();
      if (!roomId || trimmed === '') return false;
      // Not appended optimistically. The server echoes it back to the sender
      // immediately, and the round trip on a LAN is a few milliseconds — an
      // optimistic line would have to be reconciled with its own echo, or be
      // shown twice.
      return socketRef.current?.send({ t: 'chat', roomId, body: trimmed }) ?? false;
    },
    [roomId],
  );

  const requestMic = useCallback(() => {
    if (!roomId) return;
    if (socketRef.current?.send({ t: 'mic:request', roomId })) {
      // The previous answer goes with the new request — a "not now" from five
      // minutes ago should not still be on screen while a fresh hand is up.
      setState((s) => ({ ...s, micPending: true, micAnswer: null }));
    }
  }, [roomId]);

  const cancelMic = useCallback(() => {
    if (!roomId) return;
    socketRef.current?.send({ t: 'mic:cancel', roomId });
    setState((s) => ({ ...s, micPending: false }));
  }, [roomId]);

  /** Host only. The server refuses it from anyone else regardless. */
  const resolveMic = useCallback(
    (userId: string, approve: boolean) => {
      if (!roomId) return;
      socketRef.current?.send({ t: 'mic:resolve', roomId, userId, approve });
    },
    [roomId],
  );

  const clearError = useCallback(() => setState((s) => ({ ...s, lastError: null })), []);
  const clearMicAnswer = useCallback(() => setState((s) => ({ ...s, micAnswer: null })), []);

  return {
    ...state,
    sendChat,
    requestMic,
    cancelMic,
    resolveMic,
    clearError,
    clearMicAnswer,
  };
}
