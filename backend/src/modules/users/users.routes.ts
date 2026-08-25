import { Router } from 'express';
import { authGuard } from '../../middleware/authGuard.js';
import { getProfileSummary } from './summary.service.js';

export function buildUsersRouter(): Router {
  const router = Router();

  router.use(authGuard());

  // Own summary only. There is deliberately no /:id variant yet — a public
  // profile exposes follower counts and a public id, and deciding what a
  // stranger may see is a trust-and-safety question (M9), not a routing one.
  router.get('/me/summary', async (req, res, next) => {
    try {
      res.json({ summary: await getProfileSummary(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
