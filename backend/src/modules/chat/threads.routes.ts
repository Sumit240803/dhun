import { Router } from 'express';
import { z } from 'zod';
import { authGuard } from '../../middleware/authGuard.js';
import { validate } from '../../middleware/validate.js';
import { listThreads, type ThreadFilter } from './threads.service.js';

export function buildMessagesRouter(): Router {
  const router = Router();

  // A message list is private by definition. No optionalAuth here.
  router.use(authGuard());

  router.get(
    '/threads',
    validate({
      query: z
        .object({
          filter: z.enum(['all', 'official', 'unread', 'groups']).default('all'),
          limit: z.coerce.number().int().min(1).max(50).default(30),
        })
        .strict(),
    }),
    async (req, res, next) => {
      try {
        // validatedQuery, not req.query — see the note in rooms.routes.ts.
        const query = req.validatedQuery as { filter: ThreadFilter; limit: number };

        res.json({
          threads: await listThreads({
            userId: req.userId!,
            filter: query.filter,
            limit: query.limit,
          }),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
