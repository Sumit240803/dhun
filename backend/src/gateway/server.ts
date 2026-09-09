// The WebSocket gateway.
//
// Its own process, for the reason the architecture note gives: long-lived
// connections scale on concurrency rather than on request rate, and a gateway
// holding ten thousand sockets must be deployable without restarting the API
// that takes money.
//
// ── The rule every handler follows ──────────────────────────────────────────
//
// A socket carries no authority of its own. `userId` comes from a verified
// access token and nothing else; a client can say `join`, `chat` or
// `mic:request`, but it can never say WHO it is or WHAT it is allowed to do.
// Every privileged action re-checks against the database, because a socket
// that was authorised ten minutes ago may since have been banned from the room
// or removed from its seat.

import { createServer, type Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from '../config/index.js';
import { logger } from '../infra/logger.js';
import { AppError } from '../infra/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { filterText } from '../modules/moderation/textFilter.js';
import { takeSeat } from '../modules/rooms/index.js';
import { broadcast, join, leave, localRoomSize, send, startFanout, stopFanout, type Client } from './hub.js';
import { decode, type ClientMessage } from './protocol.js';
import * as state from './room.state.js';

/** How long an unauthenticated socket may sit there. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
/** Ping every client on this interval; two misses and it is gone. */
const HEARTBEAT_MS = 30_000;
/** Messages per socket per window, before it is dropped. */
const RATE_LIMIT = { max: 20, windowMs: 10_000 };

const clients = new Set<Client>();

export function buildGateway(): { server: Server; wss: WebSocketServer } {
  // A bare HTTP server alongside, purely so a load balancer has something to
  // health-check. A WebSocket endpoint cannot answer a GET.
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sockets: clients.size }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
  startFanout();

  wss.on('connection', (socket) => handleConnection(socket));

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      // Missed two rounds. The socket looks open to us and is not — a phone
      // that went through a tunnel, or a NAT that dropped the mapping.
      if (client.missedHeartbeats >= 2) {
        client.socket.terminate();
        continue;
      }
      client.missedHeartbeats += 1;
      try {
        client.socket.ping();
      } catch {
        client.socket.terminate();
      }
    }
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeat));
  return { server, wss };
}

function handleConnection(socket: WebSocket): void {
  const client: Client = { socket, userId: '', status: '', roomId: null, missedHeartbeats: 0 };
  let authenticated = false;
  let recentMessages = 0;
  let windowStartedAt = Date.now();

  // A socket that connects and says nothing is either a scanner or a broken
  // client. Either way it should not hold a file descriptor indefinitely.
  const handshakeTimer = setTimeout(() => {
    if (!authenticated) socket.close(4001, 'auth timeout');
  }, HANDSHAKE_TIMEOUT_MS);

  socket.on('pong', () => {
    client.missedHeartbeats = 0;
  });

  socket.on('message', (raw) => {
    void (async () => {
      // Counted BEFORE parsing, so malformed frames cost the sender too —
      // otherwise the cheapest attack is a flood of junk.
      const now = Date.now();
      if (now - windowStartedAt > RATE_LIMIT.windowMs) {
        windowStartedAt = now;
        recentMessages = 0;
      }
      if (++recentMessages > RATE_LIMIT.max) {
        socket.close(4029, 'too many messages');
        return;
      }

      const message = decode(raw.toString());
      if (!message) {
        send(client, { t: 'error', code: 'BAD_MESSAGE', message: 'Message not understood' });
        return;
      }

      try {
        if (!authenticated) {
          if (message.t !== 'auth') {
            socket.close(4001, 'auth required');
            return;
          }
          const claims = await verifyAccessToken(message.token);
          client.userId = claims.sub;
          client.status = claims.status;
          authenticated = true;
          clearTimeout(handshakeTimer);
          clients.add(client);
          send(client, { t: 'ready', userId: client.userId });
          return;
        }

        await handle(client, message);
      } catch (err) {
        // The same envelope shape as the REST errors, so the client's existing
        // mapper works unchanged. An unexpected error becomes a generic one —
        // never a stack trace down a socket.
        if (err instanceof AppError) {
          send(client, { t: 'error', code: err.code, message: err.message });
          return;
        }
        logger.error('gateway handler failed', { err, user_id: client.userId });
        send(client, { t: 'error', code: 'INTERNAL_ERROR', message: 'Something went wrong' });
      }
    })();
  });

  socket.on('close', () => {
    clearTimeout(handshakeTimer);
    const roomId = client.roomId;
    leave(client);
    clients.delete(client);
    // The room's viewer count changed. Announced from here rather than from a
    // webhook, because a browser tab closing produces no LiveKit event at all.
    if (roomId) broadcast(roomId, { t: 'presence', roomId, viewers: localRoomSize(roomId) });
  });

  socket.on('error', (err) => logger.warn('gateway socket error', { err }));
}

async function handle(client: Client, message: ClientMessage): Promise<void> {
  switch (message.t) {
    case 'ping':
      send(client, { t: 'pong' });
      return;

    case 'auth':
      // Already authenticated. Re-authenticating mid-session would let a socket
      // change identity, which nothing legitimate needs to do.
      return;

    case 'join': {
      const snapshot = await state.snapshot(message.roomId);
      if (await state.isBanned(message.roomId, client.userId)) {
        throw new AppError('ROOM_BANNED', 'You cannot join this room', 403);
      }

      join(client, message.roomId);

      const isHost = snapshot.hostUserId === client.userId;
      send(client, {
        t: 'joined',
        roomId: message.roomId,
        seats: snapshot.seats,
        viewers: localRoomSize(message.roomId),
        history: snapshot.history,
        // The queue is the host's business alone. Sending it to everyone would
        // publish who asked for the mic and was refused.
        ...(isHost ? { micQueue: await state.pendingMicRequests(message.roomId) } : {}),
      });

      broadcast(message.roomId, {
        t: 'presence',
        roomId: message.roomId,
        viewers: localRoomSize(message.roomId),
      });
      return;
    }

    case 'leave': {
      leave(client);
      broadcast(message.roomId, {
        t: 'presence',
        roomId: message.roomId,
        viewers: localRoomSize(message.roomId),
      });
      return;
    }

    case 'chat': {
      // The socket's own room, not the one the message claims. Otherwise a
      // client could post into any room it knows the id of without joining.
      if (client.roomId !== message.roomId) {
        throw new AppError('NOT_IN_ROOM', 'Join the room first', 409);
      }
      if (client.status !== 'active') {
        throw new AppError('REGISTRATION_REQUIRED', 'Create an account to chat', 403);
      }
      if (await state.isBanned(message.roomId, client.userId)) {
        throw new AppError('ROOM_BANNED', 'You cannot chat in this room', 403);
      }

      const result = filterText(message.body);
      // Recorded whatever the verdict, and with the ORIGINAL text — a blocked
      // message is exactly the one a report will be about.
      const line = await state.recordMessage({
        roomId: message.roomId,
        userId: client.userId,
        body: message.body,
        verdict: result.verdict,
      });

      if (result.verdict === 'blocked') {
        // Silently dropped for everyone else, and the sender is told. Pretending
        // it sent would have them repeat it; saying nothing at all looks broken.
        send(client, { t: 'error', code: 'MESSAGE_BLOCKED', message: 'That message was not sent' });
        return;
      }

      broadcast(message.roomId, {
        t: 'chat',
        roomId: message.roomId,
        line: { ...line, body: result.body },
      });
      return;
    }

    case 'mic:request': {
      if (client.roomId !== message.roomId) {
        throw new AppError('NOT_IN_ROOM', 'Join the room first', 409);
      }
      if (client.status !== 'active') {
        throw new AppError('REGISTRATION_REQUIRED', 'Create an account to take the mic', 403);
      }

      const { hostUserId } = await state.snapshot(message.roomId);
      await state.requestMic(message.roomId, client.userId);
      await pushQueue(message.roomId, hostUserId);
      return;
    }

    case 'mic:cancel': {
      const { hostUserId } = await state.snapshot(message.roomId);
      await state.cancelMic(message.roomId, client.userId);
      await pushQueue(message.roomId, hostUserId);
      return;
    }

    case 'mic:resolve': {
      const { hostUserId } = await state.snapshot(message.roomId);
      // Re-checked here, not trusted from whatever the client last knew. A
      // host who ended one room and joined another as a guest still holds a
      // socket that once had these rights.
      if (hostUserId !== client.userId) {
        throw new AppError('NOT_ROOM_HOST', 'Only the host can do that', 403);
      }

      const wasPending = await state.resolveMic(message.roomId, message.userId, message.approve);
      if (!wasPending) return;

      if (message.approve) {
        const seatIndex = message.seatIndex ?? (await state.firstFreeSeat(message.roomId));
        if (seatIndex === null) {
          throw new AppError('ROOM_FULL', 'Every seat is taken', 409);
        }
        // Through the rooms module, so there is exactly ONE path that grants a
        // seat — the same one that updates the media permission and rolls back
        // if that fails. A second implementation here would drift within a week.
        await takeSeat({ roomId: message.roomId, userId: message.userId, seatIndex });
        broadcast(message.roomId, {
          t: 'seats',
          roomId: message.roomId,
          seats: await state.listSeats(message.roomId),
        });
      }

      broadcast(
        message.roomId,
        { t: 'mic:resolved', roomId: message.roomId, approved: message.approve },
        { onlyUserId: message.userId },
      );
      await pushQueue(message.roomId, hostUserId);
      return;
    }
  }
}

/** The queue, to the host and nobody else. */
async function pushQueue(roomId: string, hostUserId: string): Promise<void> {
  broadcast(
    roomId,
    { t: 'mic:queue', roomId, requests: await state.pendingMicRequests(roomId) },
    { onlyUserId: hostUserId },
  );
}

/**
 * Announces a seat change made through the REST API.
 *
 * The gateway is not the only thing that changes a seat — taking one, leaving
 * one and being removed all go through HTTP. Without this the seat map would
 * be pushed only for gateway-initiated changes and polled for the rest, which
 * is the worst of both.
 */
export async function announceSeats(roomId: string): Promise<void> {
  broadcast(roomId, { t: 'seats', roomId, seats: await state.listSeats(roomId) });
}

/** Tells everyone still in a room that it is over, so they leave the screen. */
export function announceRoomEnded(roomId: string): void {
  broadcast(roomId, { t: 'room:ended', roomId });
}

export async function shutdownGateway(wss: WebSocketServer): Promise<void> {
  for (const client of clients) client.socket.close(1001, 'server shutting down');
  clients.clear();
  await stopFanout();
  await new Promise<void>((resolve) => wss.close(() => resolve()));
}

export { config as gatewayConfig };
