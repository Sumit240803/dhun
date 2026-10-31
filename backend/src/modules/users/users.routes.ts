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
import { blockUser, setSpendControls, spendStatus, unblockUser } from '../moderation/index.js';
import { listFriends } from './friends.service.js';
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

  /** A follow in both directions. Modelled, never stored. */
  router.get('/me/friends', async (req, res, next) => {
    try {
      res.json({ friends: await listFriends(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  // ── Spend controls (036) ──────────────────────────────────────────────────
  //
  // The user's own brakes: daily and monthly caps on gifts, and a pause of 30
  // or 90 days or for good. A cap lowers at once and raises after a delay; a
  // pause cannot be shortened while it runs. Settings, so a session suffices.

  router.get('/me/spend-controls', async (req, res, next) => {
    try {
      res.json({ spend: await spendStatus(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  router.put(
    '/me/spend-controls',
    rateLimit({ scope: 'spend-controls', limit: 20, windowMs: 3_600_000, by: 'user' }),
    validate(
      z
        .object({
          dailyCapCoins: z.number().int().min(100).max(100_000_000).nullable(),
          monthlyCapCoins: z.number().int().min(100).max(1_000_000_000).nullable(),
          // Omitted = unchanged, so caps can be edited under a running pause
          // without asking to lift it (which would be refused).
          exclusion: z.enum(['none', '30d', '90d', 'permanent']).optional(),
        })
        .strict()
        .refine(
          (v) => v.dailyCapCoins === null || v.monthlyCapCoins === null || v.dailyCapCoins <= v.monthlyCapCoins,
          { message: 'A daily limit cannot be above the monthly one', path: ['dailyCapCoins'] },
        ),
    ),
    async (req, res, next) => {
      try {
        res.json({ spend: await setSpendControls(req.userId!, req.body) });
      } catch (err) {
        next(err);
      }
    },
  );

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
