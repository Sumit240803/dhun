import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../../middleware/authGuard.js';
import { validate } from '../../middleware/validate.js';
import { listFeed } from './rooms.service.js';

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

  return router;
}
