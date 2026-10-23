import { Router } from 'express';
import { z } from 'zod';
import { authGuard, requireRegistered } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { fileAppeal, myAppeal } from './appeals.service.js';

/**
 * A suspended host's side of an appeal. Everything a reviewer does is in the
 * admin panel; a host can read their own standing and say their piece.
 */
export function buildAppealsRouter(): Router {
  const router = Router();
  router.use(authGuard(), requireRegistered());

  router.get('/me', async (req, res, next) => {
    try {
      res.json({ appeal: await myAppeal(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/',
    // One appeal per suspension is enforced by the table; this stops a script
    // from making the queue noisy with refused attempts.
    rateLimit({ scope: 'appeal', limit: 5, windowMs: 86_400_000, by: 'user' }),
    validate(z.object({ message: z.string().trim().min(20).max(1000) }).strict()),
    async (req, res, next) => {
      try {
        res.status(201).json({ appeal: await fileAppeal(req.userId!, req.body.message) });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
