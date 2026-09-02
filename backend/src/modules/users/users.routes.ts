import { Router } from 'express';
import { z } from 'zod';
import { authGuard } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import {
  followUser,
  listVisitors,
  markVisitorsSeen,
  recordVisit,
  unfollowUser,
} from './follows.service.js';
import { blockUser, unblockUser } from '../moderation/index.js';
import { getPublicProfile } from './publicProfile.service.js';
import { getProfileSummary } from './summary.service.js';

const userIdParam = z.object({ id: z.string().uuid() }).strict();

export function buildUsersRouter(): Router {
  const router = Router();

  // A session, guest included. A guest is a real server-side identity, and
  // following is the retention loop that gives them a reason to come back —
  // gating it behind a phone number would cost more than the spam it prevents.
  // The rate limits below are what actually bound the abuse.
  router.use(authGuard());

  router.get('/me/summary', async (req, res, next) => {
    try {
      res.json({ summary: await getProfileSummary(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  router.get(
    '/me/visitors',
    validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict() }),
    async (req, res, next) => {
      try {
        const { limit } = req.validatedQuery as { limit: number };
        res.json({ visitors: await listVisitors(req.userId!, limit) });
      } catch (err) {
        next(err);
      }
    },
  );

  // Clears the "N new" badge. POST rather than GET because it changes state —
  // a GET that mutates gets fired by a prefetcher and clears the badge nobody
  // ever looked at.
  router.post('/me/visitors/seen', async (req, res, next) => {
    try {
      res.json({ cleared: await markVisitorsSeen(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  // Must come AFTER the /me routes, or ':id' swallows 'me' and every request
  // for your own summary tries to parse "me" as a uuid.
  router.get('/:id/profile', validate({ params: userIdParam }), async (req, res, next) => {
    try {
      const { id } = req.validatedParams as { id: string };
      res.json({ profile: await getPublicProfile(req.userId!, id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/block', validate({ params: userIdParam }), async (req, res, next) => {
    try {
      const { id } = req.validatedParams as { id: string };
      await blockUser(req.userId!, id);
      res.json({ blocked: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id/block', validate({ params: userIdParam }), async (req, res, next) => {
    try {
      const { id } = req.validatedParams as { id: string };
      await unblockUser(req.userId!, id);
      res.json({ blocked: false });
    } catch (err) {
      next(err);
    }
  });

  // 200 follows an hour is far above any human and far below a script that
  // wants to build a graph. Per user, because the interesting abuse is one
  // account mass-following, not one IP.
  router.post(
    '/:id/follow',
    rateLimit({ scope: 'follow', limit: 200, windowMs: 3_600_000, by: 'user' }),
    validate({ params: userIdParam }),
    async (req, res, next) => {
      try {
        const { id } = req.validatedParams as { id: string };
        await followUser(req.userId!, id);
        res.json({ following: true });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/:id/follow', validate({ params: userIdParam }), async (req, res, next) => {
    try {
      const { id } = req.validatedParams as { id: string };
      await unfollowUser(req.userId!, id);
      res.json({ following: false });
    } catch (err) {
      next(err);
    }
  });

  // Recording a visit is fire-and-forget from the client's side, so it must
  // never fail loudly: viewing your own profile is silently ignored rather
  // than rejected, because the client cannot always know whose profile it is.
  router.post(
    '/:id/visit',
    rateLimit({ scope: 'visit', limit: 600, windowMs: 3_600_000, by: 'user' }),
    validate({ params: userIdParam }),
    async (req, res, next) => {
      try {
        const { id } = req.validatedParams as { id: string };
        await recordVisit(id, req.userId!);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
