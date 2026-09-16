// The realtime gateway client.
//
// A plain WebSocket with a reconnect loop, deliberately not a library. What is
// needed is one socket, one room, backoff, and a handshake — and every library
// that does that also does rooms, namespaces and its own protocol, none of
// which this app uses.
//
// ── The protocol, mirrored ──────────────────────────────────────────────────
//
// These types are hand-mirrored from `backend/src/gateway/protocol.ts`. Sharing
// them would mean a shared package, and a package boundary between two halves
// of a two-person project costs more than it saves. The gateway tests are what
// hold the two in step.

import type { GiftView } from '@/api/types';
import { env } from '@/config/env';
import { reportError } from '@/lib/reporting';

export interface ChatLine {
  id: string;
  userId: string;
  name: string | null;
  body: string;
  at: string;
}

export interface MicRequest {
  userId: string;
  name: string | null;
  requestedAt: string;
}

export interface SeatView {
  seatIndex: number;
  userId: string;
  displayName: string | null;
  muted: boolean;
}

export type ServerMessage =
  | { t: 'ready'; userId: string }
  | {
      t: 'joined';
      roomId: string;
      seats: SeatView[];
      viewers: number;
      history: ChatLine[];
      micQueue?: MicRequest[];
    }
  | { t: 'chat'; roomId: string; line: ChatLine }
  | { t: 'seats'; roomId: string; seats: SeatView[] }
  | { t: 'presence'; roomId: string; viewers: number }
  | { t: 'mic:queue'; roomId: string; requests: MicRequest[] }
  | { t: 'mic:resolved'; roomId: string; approved: boolean }
  /** Somebody sent a gift. Drives the strips and animations; the ledger has already settled. */
  | { t: 'gift'; roomId: string; gift: GiftView }
  | { t: 'room:ended'; roomId: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' };

export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'join'; roomId: string }
  | { t: 'leave'; roomId: string }
  | { t: 'chat'; roomId: string; body: string }
  | { t: 'mic:request'; roomId: string }
  | { t: 'mic:cancel'; roomId: string }
  | { t: 'mic:resolve'; roomId: string; userId: string; approve: boolean; seatIndex?: number }
  | { t: 'ping' };

export type SocketStatus = 'connecting' | 'live' | 'offline';

interface Options {
  roomId: string;
  getToken: () => Promise<string | null>;
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: SocketStatus) => void;
}

/** Backoff between reconnects. Fixed steps, so a bad network cannot run away. */
const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000];

/**
 * One connection to one room, kept alive until `close()`.
 *
 * The reconnect loop is the whole point of this class. A phone loses its
 * socket constantly — a tunnel, a lift, switching from Wi-Fi to mobile data,
 * the screen locking — and a chat that needs the user to back out and re-enter
 * the room after each one is a chat nobody uses.
 */
export class RoomSocket {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** Set once the server accepts the handshake; nothing is sent before it. */
  private ready = false;

  constructor(private readonly options: Options) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    this.options.onStatus(this.attempt === 0 ? 'connecting' : 'offline');

    void (async () => {
      const token = await this.options.getToken();
      // No session. Not an error — the user signed out while the screen was
      // open, and the app is already navigating away.
      if (!token || this.closed) return;

      const socket = new WebSocket(`${env.gatewayUrl}/ws`);
      this.socket = socket;

      socket.onopen = () => {
        // The token goes in the FIRST MESSAGE, not the URL. A query string
        // ends up in every access and proxy log along the path, and unlike a
        // header there is no redacting it afterwards.
        socket.send(JSON.stringify({ t: 'auth', token } satisfies ClientMessage));
      };

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        if (message.t === 'ready') {
          this.ready = true;
          this.attempt = 0;
          this.options.onStatus('live');
          // Re-joining on every connect, not just the first. After a
          // reconnect the server has no memory of this socket at all, and the
          // rejoin is what re-delivers the seat map and the backlog missed
          // while it was down.
          this.send({ t: 'join', roomId: this.options.roomId });
          return;
        }

        this.options.onMessage(message);
      };

      socket.onerror = () => {
        // Deliberately quiet. A dropped socket on a phone is ordinary, and
        // reporting each one would bury the failures that matter.
      };

      socket.onclose = () => {
        this.ready = false;
        this.socket = null;
        if (this.closed) return;

        this.options.onStatus('offline');
        const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
        this.attempt += 1;
        this.timer = setTimeout(() => this.connect(), delay);
      };
    })().catch((error) => {
      reportError(error, { code: 'GATEWAY_CONNECT_FAILED', screen: 'room' });
      this.options.onStatus('offline');
    });
  }

  /**
   * Sends, if the socket is up.
   *
   * Dropped silently when it is not. Queueing would be worse: a chat line
   * written during an outage and delivered four minutes later, out of context,
   * is more confusing than one that never sent — and the composer already
   * shows the connection state.
   */
  send(message: ClientMessage): boolean {
    if (!this.socket || !this.ready || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
  }
}
