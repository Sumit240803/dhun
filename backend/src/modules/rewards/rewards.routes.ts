import { Router } from 'express';
import { z } from 'zod';
import { authGuard, requireRegistered } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { requireFeature } from '../config/index.js';
import {
  attachReferral,
  claimCheckin,
  claimNewUserTask,
  claimWelcome,
  newUserRewards,
  rewardsStatus,
  type NewUserTask,
} from './rewards.service.js';

export function buildRewardsRouter(): Router {
  const router = Router();
  router.use(authGuard());

  router.get('/', async (req, res, next) => {
    try {
      res.json({ rewards: await rewardsStatus(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  // No Idempotency-Key header on the claims. The key is derived from the claim
  // itself on the server, which is stronger than any client value: a claim for
  // today's check-in is the same claim however many times, and from however
  // many devices, it is asked for.
  const claimLimit = rateLimit({
    scope: 'rewards:claim',
    limit: 20,
    windowMs: 60_000,
    by: 'user',
  });

  // Every claim sits behind the free-coins switch. The ledger's own switch
  // (free_coin_grant inactive) backs it up for anything that gets past.
  const paused = requireFeature('rewards');

  router.post('/welcome', requireRegistered(), paused, claimLimit, async (req, res, next) => {
    try {
      res.json(await claimWelcome(req.userId!));
    } catch (err) {
      next(err);
    }
  });

  router.post('/checkin', requireRegistered(), paused, claimLimit, async (req, res, next) => {
    try {
      res.json(await claimCheckin(req.userId!));
    } catch (err) {
      next(err);
    }
  });

  // The new-user sheet. `newUser: null` means there is no sheet: the window
  // has closed, and it never reopens.
  router.get('/new-user', async (req, res, next) => {
    try {
      res.json({ newUser: await newUserRewards(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/new-user/:task',
    requireRegistered(),
    paused,
    claimLimit,
    validate({
      params: z.object({ task: z.enum(['follow', 'gift', 'chat']) }).strict(),
    }),
    async (req, res, next) => {
      try {
        res.json(await claimNewUserTask(req.userId!, req.params.task as NewUserTask));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/referral',
    requireRegistered(),
    // Low: guessing codes is the abuse, and nobody legitimately enters more
    // than a couple.
    rateLimit({
      scope: 'rewards:referral',
      limit: 10,
      windowMs: 3_600_000,
      by: 'user',
    }),
    validate(z.object({ code: z.string().trim().min(1).max(20) }).strict()),
    async (req, res, next) => {
      try {
        res.json(await attachReferral(req.userId!, req.body.code));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
