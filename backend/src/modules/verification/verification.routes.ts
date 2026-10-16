import { Router } from 'express';
import { z } from 'zod';
import { authGuard, requireRegistered } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { submitVerification, verificationFor } from './verification.service.js';

/**
 * The host's own side of verification.
 *
 * Two routes: see where my submission stands, and submit one. Everything a
 * moderator does lives in the admin panel behind a staff guard — a host can
 * read their own status and nothing else, and cannot see a queue, a reviewer's
 * name, or anybody else's photo.
 */
export function buildVerificationRouter(): Router {
  const router = Router();
  router.use(authGuard(), requireRegistered());

  /** Where my verification stands. `none` until they submit. */
  router.get('/me', async (req, res, next) => {
    try {
      res.json({ verification: await verificationFor(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Submit a face photo for review.
   *
   * Takes an upload KEY, never a URL — the same contract as avatars and room
   * covers, and `claimUpload` proves the object exists under this user's own
   * prefix before anything is written.
   *
   * Rate-limited tightly: a human reviews every one of these, so a hundred
   * submissions is a hundred minutes of somebody's day.
   */
  router.post(
    '/',
    rateLimit({ scope: 'verification:submit', limit: 5, windowMs: 3_600_000, by: 'user' }),
    validate(z.object({ faceKey: z.string().trim().min(8).max(256) }).strict()),
    async (req, res, next) => {
      try {
        res.status(201).json({
          verification: await submitVerification(req.userId!, req.body.faceKey),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
