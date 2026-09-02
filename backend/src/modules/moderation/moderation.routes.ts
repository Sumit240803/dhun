import { Router } from 'express';
import { z } from 'zod';
import { authGuard } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { REPORT_REASONS, fileReport, type ReportReason, type SubjectType } from './moderation.service.js';

export function buildModerationRouter(): Router {
  const router = Router();

  router.use(authGuard());

  // 30 an hour. High enough that someone reporting a raid is never blocked —
  // which is exactly when reporting matters most — and low enough that a
  // script cannot bury the queue.
  router.post(
    '/reports',
    rateLimit({ scope: 'report', limit: 30, windowMs: 3_600_000, by: 'user' }),
    validate(
      z.object({
        subjectType: z.enum(['user', 'room', 'message']),
        subjectId: z.string().uuid(),
        reason: z.enum(REPORT_REASONS),
        detail: z.string().max(500).optional(),
      }),
    ),
    async (req, res, next) => {
      try {
        const body = req.body as {
          subjectType: SubjectType;
          subjectId: string;
          reason: ReportReason;
          detail?: string;
        };

        const result = await fileReport({ reporterId: req.userId!, ...body });

        // 202, not 201: the report is ACCEPTED, and whether it results in
        // anything is a decision a human makes later. Promising more than that
        // in the status code is a promise the queue cannot keep.
        res.status(202).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
