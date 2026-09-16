import { Router } from 'express';
import { z } from 'zod';
import { authGuard, optionalAuth, requireRegistered } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { endRoom, getRoom, goLive, joinRoom } from './live.service.js';
import { fullestRoom, listFeed } from './rooms.service.js';
import { kickFromRoom, releaseSeat, setSeatMuted, takeSeat } from './seats.service.js';

export function buildRoomsRouter(): Router {
  const router = Router();

  // optionalAuth, not authGuard: browsing is the top of the funnel, and a
  // signed-out user has to be able to see what the app IS before being asked
  // for a phone number. The Following category needs a viewer and returns
  // empty without one — handled in the service rather than by a 401 here.
  router.use(optionalAuth());

  router.get(
    '/feed',
    validate({
      query: z
        .object({
          category: z.enum(['explore', 'party', 'following']).default('explore'),
          // Bounded. An unbounded limit is a denial-of-service that costs the
          // attacker exactly one request.
          limit: z.coerce.number().int().min(1).max(50).default(20),
          offset: z.coerce.number().int().min(0).max(10_000).default(0),
        })
        .strict(),
    }),
    async (req, res, next) => {
      try {
        // validatedQuery, NOT req.query: Express 5 exposes req.query through a
        // getter, so the middleware keeps the parsed value beside it. Reading
        // the raw one loses every zod default — `category` came back undefined
        // and every unfiltered request silently fell through to Following.
        const query = req.validatedQuery as {
          category: 'explore' | 'party' | 'following';
          limit: number;
          offset: number;
        };

        res.json({
          rooms: await listFeed({
            category: query.category,
            viewerId: req.userId,
            limit: query.limit,
            offset: query.offset,
          }),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  const roomIdParam = z.object({ id: z.string().uuid() }).strict();

  // ---------------------------------------------------------------------
  // Going live
  //
  // requireRegistered, not just authGuard: a guest browsing anonymously must
  // not be able to broadcast. Hosting is an identity with a payout attached.
  // ---------------------------------------------------------------------
  router.post(
    '/live',
    authGuard(),
    requireRegistered(),
    // A host starting rooms in a loop is either a bug or an attempt to spam the
    // feed. Either way the ceiling is low, because going live is a rare act.
    rateLimit({ scope: 'room:golive', limit: 10, windowMs: 3_600_000, by: 'user' }),
    validate(
      z.object({
        title: z.string().trim().min(1).max(60),
        tag: z.enum(['singing', 'dancing', 'chatting', 'gaming', 'friends', 'esports']),
        isVideo: z.boolean().default(false),
        // Present makes it a party room, absent makes it a single-host
        // broadcast. Bounded to what the rooms table allows.
        seatCapacity: z.number().int().min(2).max(20).optional(),
        coverUrl: z.string().url().max(512).optional(),
        country: z.string().length(2).toUpperCase().optional(),
      }),
    ),
    async (req, res, next) => {
      try {
        res.status(201).json(
          await goLive({
            hostId: req.userId!,
            title: req.body.title,
            tag: req.body.tag,
            isVideo: req.body.isVideo,
            seatCapacity: req.body.seatCapacity,
            coverUrl: req.body.coverUrl,
            country: req.body.country,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  // Where a brand-new user is dropped on first open. Declared BEFORE `/:id`,
  // which would otherwise read "fullest" as a room id and refuse it.
  router.get('/fullest', async (req, res, next) => {
    try {
      res.json({ room: await fullestRoom(req.userId) });
    } catch (err) {
      next(err);
    }
  });

  // The room and its seat map, without joining. What a feed card expands into,
  // and readable without a session for the same reason the feed is.
  router.get(
    '/:id',
    validate({ params: roomIdParam }),
    async (req, res, next) => {
      try {
        const { id } = req.validatedParams as { id: string };
        res.json(await getRoom(id));
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // Joining
  //
  // Returns a media token whose PUBLISH grant comes from the seat table, never
  // from the request. There is deliberately no way to ask for publish rights.
  // ---------------------------------------------------------------------
  router.post(
    '/:id/join',
    authGuard(),
    // Reconnects are normal and should not be throttled into failure, but a
    // client looping on join is minting tokens as fast as it can ask.
    rateLimit({ scope: 'room:join', limit: 60, windowMs: 300_000, by: 'user' }),
    validate({ params: roomIdParam }),
    async (req, res, next) => {
      try {
        const { id } = req.validatedParams as { id: string };
        res.json(await joinRoom({ roomId: id, userId: req.userId! }));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/:id/end',
    authGuard(),
    validate({ params: roomIdParam }),
    async (req, res, next) => {
      try {
        const { id } = req.validatedParams as { id: string };
        await endRoom({ roomId: id, hostId: req.userId! });
        res.json({ ended: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // Seats
  // ---------------------------------------------------------------------

  router.post(
    '/:id/seats',
    authGuard(),
    requireRegistered(),
    rateLimit({ scope: 'room:seat', limit: 30, windowMs: 300_000, by: 'user' }),
    validate({
      params: roomIdParam,
      body: z.object({ seatIndex: z.number().int().min(0).max(19) }).strict(),
    }),
    async (req, res, next) => {
      try {
        const { id } = req.validatedParams as { id: string };
        await takeSeat({ roomId: id, userId: req.userId!, seatIndex: req.body.seatIndex });
        res.json({ seated: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // Leaving your own seat, or the host removing someone from theirs — the same
  // action with a different actor, so it is one route rather than two.
  router.delete(
    '/:id/seats/:userId',
    authGuard(),
    validate({
      params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }).strict(),
    }),
    async (req, res, next) => {
      try {
        const { id, userId } = req.validatedParams as { id: string; userId: string };
        await releaseSeat({ roomId: id, userId, actorId: req.userId! });
        res.json({ released: true });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/:id/seats/:userId/mute',
    authGuard(),
    validate({
      params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }).strict(),
      body: z.object({ muted: z.boolean() }).strict(),
    }),
    async (req, res, next) => {
      try {
        const { id, userId } = req.validatedParams as { id: string; userId: string };
        await setSeatMuted({
          roomId: id,
          userId,
          hostId: req.userId!,
          muted: req.body.muted,
        });
        res.json({ muted: req.body.muted });
      } catch (err) {
        next(err);
      }
    },
  );

  // Bars them from rejoining, then disconnects. The ban row is what lasts —
  // see the note in seats.service.ts.
  router.post(
    '/:id/kick/:userId',
    authGuard(),
    validate({
      params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }).strict(),
      body: z.object({ reason: z.string().trim().max(200).optional() }).strict(),
    }),
    async (req, res, next) => {
      try {
        const { id, userId } = req.validatedParams as { id: string; userId: string };
        await kickFromRoom({
          roomId: id,
          userId,
          hostId: req.userId!,
          reason: req.body.reason,
        });
        res.json({ kicked: true });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
