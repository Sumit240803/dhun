// Who is connected, and how a message reaches all of them.
//
// ── Two layers, and why both are needed ─────────────────────────────────────
//
// LOCAL: a map of roomId → sockets on THIS process. Sending to it is a loop
// over an array, which is what makes chat feel instant.
//
// REDIS: a pub/sub channel per room. Every instance subscribes, so a message
// published by one reaches sockets held by another.
//
// Today there is one instance and the Redis hop is pure overhead. It is built
// now anyway, because the alternative is discovering at 5,000 concurrent that
// chat silently splits into two rooms depending on which pod you landed on —
// and by then the fix touches every handler rather than this one file.
//
// The instance id keeps a publisher from processing its own echo: the local
// send already happened, and delivering it twice would double every message.

import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../infra/logger.js';
import {
  roomChannel,
  roomIdFromChannel,
  ROOM_BUS_OPTIONS,
  type RoomEnvelope,
} from '../infra/roomBus.js';
import { encode, type ServerMessage } from './protocol.js';

/** One connected client. */
export interface Client {
  socket: WebSocket;
  userId: string;
  status: string;
  /** The single room this socket is in. A phone shows one room at a time. */
  roomId: string | null;
  /** Cleared by the pong handler; a client that misses two is dropped. */
  missedHeartbeats: number;
  /**
   * Time spent in the current room, for the watch reward. Null outside a room
   * and for the room's own host — hosting is not watching.
   */
  watch: WatchClock | null;
}

export interface WatchClock {
  roomId: string;
  /** Milliseconds accrued towards the next reward interval. */
  accruedMs: number;
  /** When accrual was last brought up to date. */
  lastAt: number;
  /** The IST day this socket hit the daily cap. No more accrual until it changes. */
  cappedOn: string | null;
}

const INSTANCE_ID = randomUUID();

/** roomId → the sockets in it on this process. */
const rooms = new Map<string, Set<Client>>();

/**
 * Separate connections for publishing and subscribing.
 *
 * A Redis connection in subscribe mode refuses ordinary commands, so sharing
 * one would break the first PUBLISH. Both are lazy — nothing connects until
 * the gateway actually starts.
 */
let publisher: Redis | null = null;
let subscriber: Redis | null = null;

export function localRoomSize(roomId: string): number {
  return rooms.get(roomId)?.size ?? 0;
}

export function join(client: Client, roomId: string): void {
  leave(client);
  client.roomId = roomId;

  let set = rooms.get(roomId);
  if (!set) {
    set = new Set();
    rooms.set(roomId, set);
    subscribeQuietly(roomId);
  }
  set.add(client);
}

export function leave(client: Client): void {
  const roomId = client.roomId;
  if (!roomId) return;

  const set = rooms.get(roomId);
  set?.delete(client);
  client.roomId = null;

  // Nobody left here. Unsubscribing keeps a long-running process from
  // accumulating a channel for every room it has ever seen.
  if (set && set.size === 0) {
    rooms.delete(roomId);
    subscriber?.unsubscribe(roomChannel(roomId)).catch(() => {
      // Redis is unreachable. The local registry is already updated, so
      // nothing reaches this room from here regardless.
    });
  }
}

/** One socket. Used for replies to a specific request. */
export function send(client: Client, message: ServerMessage): void {
  // 1 === OPEN. Writing to a closing socket throws, and a throw here would
  // take down a broadcast loop halfway through.
  if (client.socket.readyState !== 1) return;
  try {
    client.socket.send(encode(message));
  } catch (err) {
    logger.warn('gateway send failed', { err });
  }
}

/**
 * Everyone in the room, on every instance.
 *
 * Local first and synchronously, so the sender sees their own message
 * immediately rather than after a Redis round trip.
 */
export function broadcast(
  roomId: string,
  message: ServerMessage,
  options: { onlyUserId?: string } = {},
): void {
  sendLocal(roomId, message, options.onlyUserId);

  const envelope: RoomEnvelope = {
    from: INSTANCE_ID,
    message,
    onlyUserId: options.onlyUserId,
  };

  void publisher
    ?.publish(roomChannel(roomId), JSON.stringify(envelope))
    .catch((err) => logger.warn('gateway publish failed', { err, room_id: roomId }));
}

/**
 * Subscribes, and does not care if it fails.
 *
 * Every one of these used to be a bare `void subscriber?.subscribe(...)`. With
 * Redis down that rejects, and an unhandled rejection takes down the one
 * process holding every live socket — the exact failure this file claims to
 * survive. The `ready` handler re-subscribes everything once it heals.
 */
function subscribeQuietly(roomId: string): void {
  subscriber?.subscribe(roomChannel(roomId)).catch(() => {});
}

function sendLocal(roomId: string, message: ServerMessage, onlyUserId?: string): void {
  const set = rooms.get(roomId);
  if (!set) return;

  for (const client of set) {
    if (onlyUserId !== undefined && client.userId !== onlyUserId) continue;
    send(client, message);
  }
}

/** Connects the pub/sub pair. Called once, when the gateway starts. */
export function startFanout(): void {
  publisher = new Redis(config.redisUrl, ROOM_BUS_OPTIONS);
  subscriber = new Redis(config.redisUrl, ROOM_BUS_OPTIONS);

  subscriber.on('message', (channel, payload) => {
    let envelope: RoomEnvelope;
    try {
      envelope = JSON.parse(payload) as RoomEnvelope;
    } catch {
      return;
    }

    // Our own echo. The local send already happened, synchronously, which is
    // what makes a sender see their own chat line without a Redis round trip.
    if (envelope.from === INSTANCE_ID) return;

    sendLocal(
      roomIdFromChannel(channel),
      envelope.message as ServerMessage,
      envelope.onlyUserId,
    );
  });

  // Logged rather than fatal. ioredis reconnects on its own, and a gateway
  // that still delivers to its OWN clients during a Redis blip is far better
  // than one that exits and drops every live room it was holding.
  publisher.on('error', (err) => logger.error('gateway publisher error', { err }));
  subscriber.on('error', (err) => logger.error('gateway subscriber error', { err }));

  // Re-subscribing after a reconnect. Without this, a Redis restart silently
  // severs cross-instance delivery and nothing ever reports it.
  subscriber.on('ready', () => {
    for (const roomId of rooms.keys()) subscribeQuietly(roomId);
  });
}

export async function stopFanout(): Promise<void> {
  await Promise.allSettled([publisher?.quit(), subscriber?.quit()]);
  publisher = null;
  subscriber = null;
  rooms.clear();
}
