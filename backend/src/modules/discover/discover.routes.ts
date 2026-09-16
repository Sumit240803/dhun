import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { search } from './search.service.js';

export function buildDiscoverRouter(): Router {
  const router = Router();

  // Readable signed out, like the feed: finding a host by name is often the
  // very first thing someone does after installing because a host told them to.
  router.use(optionalAuth());

  router.get(
    '/search',
    // Search-as-you-type, debounced on the client. Generous enough for that,
    // low enough that walking the user list by prefix is slow work.
    rateLimit({ scope: 'discover:search', limit: 120, windowMs: 60_000, by: 'ip' }),
    validate({ query: z.object({ q: z.string().max(60) }).strict() }),
    async (req, res, next) => {
      try {
        const { q } = req.validatedQuery as { q: string };
        res.json(await search(q, req.userId));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
