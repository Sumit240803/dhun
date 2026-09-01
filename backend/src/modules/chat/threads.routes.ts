import { Router } from 'express';
import { z } from 'zod';
import { authGuard } from '../../middleware/authGuard.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../infra/errors.js';
import { listMessages, listThreads, markThreadRead, type ThreadFilter } from './threads.service.js';

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

  const threadIdParam = z.object({ id: z.string().uuid() }).strict();

  router.get(
    '/threads/:id/messages',
    validate({
      params: threadIdParam,
      query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict(),
    }),
    async (req, res, next) => {
      try {
        const { id } = req.validatedParams as { id: string };
        const { limit } = req.validatedQuery as { limit: number };

        res.json({
          messages: await listMessages({ userId: req.userId!, threadId: id, limit }),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // Clears the unread badge. POST, not GET: a GET that mutates gets fired by a
  // prefetcher and marks a thread read that nobody opened.
  router.post('/threads/:id/read', validate({ params: threadIdParam }), async (req, res, next) => {
    try {
      const { id } = req.validatedParams as { id: string };
      const marked = await markThreadRead(req.userId!, id);

      // Not a member. 404 rather than 403 — telling a stranger that a thread
      // exists but is not theirs is itself a leak.
      if (!marked) throw new AppError('THREAD_NOT_FOUND', 'That conversation does not exist', 404);

      res.json({ read: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
