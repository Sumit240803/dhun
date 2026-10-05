// The channel between the API process and the gateway process.
//
// Seats change in two places. A host approving a mic request changes one over
// a WEBSOCKET; taking a seat, leaving one, being removed and being kicked all
// change one over HTTP. Without this, only the first kind would be pushed and
// the rest would still need polling — the worst of both designs.
//
// So the API publishes here and the gateway, which subscribes to exactly these
// channels for its own fan-out, delivers it to the sockets. The API holds no
// sockets and the gateway holds no routes; Redis is the only thing between
// them, which is also what lets either scale to more than one instance.
//
// The envelope is shared rather than duplicated because the two processes must
// agree on it byte for byte, and two copies of a wire format drift.

import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from './logger.js';

export const ROOM_CHANNEL_PREFIX = 'room:';

export function roomChannel(roomId: string): string {
  return ROOM_CHANNEL_PREFIX + roomId;
}

export function roomIdFromChannel(channel: string): string {
  return channel.slice(ROOM_CHANNEL_PREFIX.length);
}

/**
 * What travels between processes.
 *
 * `message` is deliberately untyped here — `ServerMessage` lives in the gateway
 * and importing it would pull the gateway's protocol into the API process for
 * no benefit. The gateway is the only thing that interprets it.
 */
export interface RoomEnvelope {
  /** The publishing instance, so it can ignore its own echo. */
  from: string;
  message: unknown;
  /** Deliver to one user only — the host's mic queue. */
  onlyUserId?: string;
}

/**
 * How every Redis connection on the room bus behaves when Redis is not there.
 *
 * Shared by the API's publisher and the gateway's pub/sub pair, because they
 * need identical behaviour and two copies of this would drift.
 *
 *   · `enableOfflineQueue: false` — commands FAIL FAST while disconnected
 *     rather than queueing. A queue that grows for the length of an outage is
 *     an unbounded memory leak on the one process holding every live socket.
 *
 *   · `maxRetriesPerRequest: 1` — with ioredis's default of 20, a command
 *     issued during an outage retries twenty times and then rejects, and any
 *     caller that did not attach a `.catch()` takes the process down with an
 *     unhandled rejection. That is precisely what happened the first time this
 *     ran on a machine with no Redis.
 *
 *   · `retryStrategy` — reconnect forever, backing off to five seconds. The
 *     connection heals on its own; only individual commands fail.
 *
 * The intent behind all three: fan-out is a COURTESY. Cross-instance delivery
 * failing should cost a client one extra poll — never a crash, and never the
 * HTTP request that triggered it.
 */
export const ROOM_BUS_OPTIONS = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt: number) => Math.min(attempt * 200, 5_000),
} as const;

/**
 * Lazily connected, and only when something actually publishes.
 *
 * The API process should not open a Redis connection it may never use — and
 * nothing in the API needs Redis today except this.
 */
let publisher: Redis | null = null;

function client(): Redis {
  if (!publisher) {
    publisher = new Redis(config.redisUrl, ROOM_BUS_OPTIONS);
    // Logged, never thrown. A failed announcement means a client polls a beat
    // longer; a thrown one would fail the HTTP request that took the seat,
    // which is a real action the user completed.
    publisher.on('error', (err) => logger.warn('room bus publisher error', { err }));
  }
  return publisher;
}

/**
 * Announces something to everyone in a room.
 *
 * Fire and forget by design. The caller has already committed its change and
 * the announcement is a courtesy that saves a poll — it must never be able to
 * fail the operation that triggered it.
 */
export function publishToRoom(roomId: string, message: unknown, onlyUserId?: string): void {
  const envelope: RoomEnvelope = { from: 'api', message, onlyUserId };

  void client()
    .publish(roomChannel(roomId), JSON.stringify(envelope))
    .catch((err) => logger.warn('room bus publish failed', { err, room_id: roomId }));
}

/**
 * Shut the publisher down without waiting for a connection that may never come.
 *
 * `quit()` QUEUES a QUIT command, and a queued command is only sent once the
 * client is connected — so a client that never reached Redis waits forever, and
 * whoever called this never exits. That is a hung seed script in development
 * and, worse, a process that ignores SIGTERM in production on the one day Redis
 * is already down. Polite shutdown when there is a connection to be polite on;
 * otherwise drop it.
 */
export async function closeRoomBus(): Promise<void> {
  const open = publisher;
  publisher = null;
  if (!open) return;

  if (open.status === 'ready') await open.quit();
  else open.disconnect();
}
