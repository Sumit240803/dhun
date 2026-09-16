import { Router } from 'express';
import { z } from 'zod';
import { authGuard, requireRegistered } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import {
  attachReferral,
  claimCheckin,
  claimWelcome,
  rewardsStatus,
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
  const claimLimit = rateLimit({ scope: 'rewards:claim', limit: 20, windowMs: 60_000, by: 'user' });

  router.post('/welcome', requireRegistered(), claimLimit, async (req, res, next) => {
    try {
      res.json(await claimWelcome(req.userId!));
    } catch (err) {
      next(err);
    }
  });

  router.post('/checkin', requireRegistered(), claimLimit, async (req, res, next) => {
    try {
      res.json(await claimCheckin(req.userId!));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/referral',
    requireRegistered(),
    // Low: guessing codes is the abuse, and nobody legitimately enters more
    // than a couple.
    rateLimit({ scope: 'rewards:referral', limit: 10, windowMs: 3_600_000, by: 'user' }),
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
