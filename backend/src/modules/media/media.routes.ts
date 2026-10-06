import { Router } from 'express';
import { z } from 'zod';
import { authGuard, requireRegistered } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { createUpload, UPLOAD_PURPOSES } from './media.service.js';

export function buildMediaRouter(): Router {
  const router = Router();
  router.use(authGuard(), requireRegistered());

  /**
   * Ask for somewhere to put an image.
   *
   * Returns a URL the app PUTs the bytes to directly. Nothing is recorded here:
   * an upload slot that is never used costs us an object nobody references, and
   * the key only becomes real when it is claimed alongside a profile or a room.
   *
   * Rate-limited per user rather than per IP — signing is cheap, but each slot
   * is permission to write an object to our bucket, and that is worth counting.
   */
  router.post(
    '/uploads',
    rateLimit({ scope: 'media:upload', limit: 30, windowMs: 600_000, by: 'user' }),
    validate(
      z
        .object({
          purpose: z.enum(UPLOAD_PURPOSES),
          contentType: z.string().trim().max(60),
        })
        .strict(),
    ),
    async (req, res, next) => {
      try {
        res
          .status(201)
          .json(await createUpload(req.userId!, req.body.purpose, req.body.contentType));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
