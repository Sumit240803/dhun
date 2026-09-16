import { Router } from 'express';
import { z } from 'zod';
import { authGuard } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { clearPushToken, PUSH_TOKEN, registerPushToken } from './notifications.service.js';

const deviceId = z.string().min(8).max(128);

export function buildNotificationsRouter(): Router {
  const router = Router();
  router.use(authGuard());

  // Guests may register too: "a host you follow is live" is not a money
  // feature, and a guest who follows someone should hear about it.
  router.post(
    '/token',
    rateLimit({ scope: 'push:token', limit: 20, windowMs: 3_600_000, by: 'user' }),
    validate(
      z
        .object({
          deviceId,
          token: z.string().max(200).regex(PUSH_TOKEN, 'Not a push token'),
        })
        .strict(),
    ),
    async (req, res, next) => {
      try {
        await registerPushToken({
          userId: req.userId!,
          deviceId: req.body.deviceId,
          token: req.body.token,
        });
        res.json({ registered: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // Signing out, or turning notifications off in the app.
  router.delete(
    '/token',
    validate(z.object({ deviceId }).strict()),
    async (req, res, next) => {
      try {
        await clearPushToken(req.userId!, req.body.deviceId);
        res.json({ registered: false });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
