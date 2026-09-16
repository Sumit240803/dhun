// The wire protocol, both directions, in one file.
//
// Every byte a client sends is hostile until zod says otherwise — the same
// rule as the REST surface, and more important here, not less: a WebSocket
// frame skips the middleware stack entirely. There is no `validate()` in front
// of a socket, so this file IS the validation layer.
//
// ── Shape ───────────────────────────────────────────────────────────────────
//
// `t` is the discriminator, kept to one character because it is on every frame
// of a chat stream and the rest of the envelope is already small. Everything
// else is named in full — nobody will thank us for `u` and `r` in a log.
//
// The protocol is deliberately NOT symmetric. A client can ask for four things;
// the server can say twelve. That asymmetry is the point: the client requests,
// the server decides and broadcasts, and no client message ever describes
// state — only intent.

import { z } from 'zod';

/** Room ids are uuids everywhere. A malformed one never reaches a query. */
const roomId = z.string().uuid();

/**
 * What a client may send.
 *
 * `auth` is separate from the connection URL on purpose: a token in a query
 * string ends up in every access log, proxy log and error report along the
 * path, and unlike a header there is no way to redact it after the fact.
 */
export const clientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('auth'), token: z.string().min(10).max(4096) }).strict(),
  z.object({ t: z.literal('join'), roomId }).strict(),
  z.object({ t: z.literal('leave'), roomId }).strict(),
  z
    .object({
      t: z.literal('chat'),
      roomId,
      // Matches the column. Longer than a chat line ever needs to be and short
      // enough that a thousand of them is not a memory problem.
      body: z.string().trim().min(1).max(500),
    })
    .strict(),
  z.object({ t: z.literal('mic:request'), roomId }).strict(),
  z.object({ t: z.literal('mic:cancel'), roomId }).strict(),
  z
    .object({
      t: z.literal('mic:resolve'),
      roomId,
      userId: z.string().uuid(),
      approve: z.boolean(),
      // Which seat to put them on. Absent means "the first free one", which is
      // what a host tapping ✓ on a queue entry actually means.
      seatIndex: z.number().int().min(1).max(19).optional(),
    })
    .strict(),
  // Heartbeat. The server also pings at the protocol level; this is the
  // client's way of proving the *application* is alive, not just the socket.
  z.object({ t: z.literal('ping') }).strict(),
]);

export type ClientMessage = z.infer<typeof clientMessage>;

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

/**
 * A gift, as the room is told about it.
 *
 * Carries everything a strip draws, so the client never makes a request per
 * gift to look up a name or an avatar — in a room receiving a gift a second,
 * that would be a request a second from every viewer.
 *
 * ⚠️ Nothing publishes this yet. The send path — the ledger transaction, the
 * idempotency key, the 18+ gate — is M6 and needs its decisions settled in
 * ledger-decisions.md first. It is defined now so the app's strips are built
 * against the real contract rather than a guess at it.
 */
export interface GiftView {
  /** The ledger transaction id. Clients dedupe on it. */
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  /** The sender's equipped avatar frame asset path, when they have one. */
  senderFrame: string | null;
  recipientId: string;
  recipientName: string | null;
  giftId: string;
  giftName: string;
  giftIcon: string | null;
  tier: number;
  coinPrice: number;
  /** The combo multiplier on this send: 1, 10, 99, 520, 999. */
  quantity: number;
}

export interface SeatView {
  seatIndex: number;
  userId: string;
  displayName: string | null;
  muted: boolean;
}

/**
 * What the server may send.
 *
 * A plain type rather than a zod schema: this side is constructed by us, and
 * validating our own output would be theatre. The client mirrors it.
 */
export type ServerMessage =
  /** The handshake succeeded. Nothing else is accepted before this. */
  | { t: 'ready'; userId: string }
  /** The room as it stands right now, sent once on joining. */
  | {
      t: 'joined';
      roomId: string;
      seats: SeatView[];
      viewers: number;
      /** A short backlog, so a late arrival does not see an empty room. */
      history: ChatLine[];
      /** Present only for the host. Nobody else is shown the queue. */
      micQueue?: MicRequest[];
    }
  | { t: 'chat'; roomId: string; line: ChatLine }
  /** The seat map changed. Replaces the polling the room screen does today. */
  | { t: 'seats'; roomId: string; seats: SeatView[] }
  | { t: 'presence'; roomId: string; viewers: number }
  /** Host only. */
  | { t: 'mic:queue'; roomId: string; requests: MicRequest[] }
  /** A gift was sent in this room. Drives the strips. */
  | { t: 'gift'; roomId: string; gift: GiftView }
  /** Requester only — the answer to their own raised hand. */
  | { t: 'mic:resolved'; roomId: string; approved: boolean }
  /** The host ended it, or a moderator did. The client leaves the screen. */
  | { t: 'room:ended'; roomId: string }
  /**
   * Something went wrong with a specific message.
   *
   * Carries the same `code` vocabulary as the REST errors, so the client's
   * existing error mapper works unchanged rather than needing a second one.
   */
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' };

export function encode(message: ServerMessage): string {
  return JSON.stringify(message);
}

/**
 * Parses one inbound frame.
 *
 * Returns null rather than throwing for anything malformed — a client sending
 * junk is a client to ignore, not an exception to propagate through the
 * connection handler. The caller closes the socket if junk keeps arriving.
 */
export function decode(raw: string): ClientMessage | null {
  if (raw.length > 8192) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = clientMessage.safeParse(parsed);
  return result.success ? result.data : null;
}
