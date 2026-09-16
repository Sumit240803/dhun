import { Router } from 'express';
import { z } from 'zod';
import {
  authGuard,
  optionalAuth,
  requireAdult,
  requireRegistered,
} from '../../middleware/authGuard.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { GIFT_QUANTITIES, roomLeaderboard, sendGift, type GiftQuantity } from './gifts.service.js';

export function buildGiftsRouter(): Router {
  const router = Router();

  // ---------------------------------------------------------------------
  // Sending
  //
  // A money endpoint, with everything that means: registered, 18+ with a
  // verified contact, an Idempotency-Key, and a strict body. Guests may watch
  // a room and never spend in it.
  // ---------------------------------------------------------------------
  router.post(
    '/send',
    authGuard(),
    requireRegistered(),
    requireAdult(),
    // Its own scope rather than the shared `money` one. A combo is a thumb
    // tapping as fast as it can, several times a second, and thirty a minute
    // would throttle a genuine whale mid-streak — the worst moment to refuse
    // money. Three hundred still stops a script.
    rateLimit({ scope: 'gift', limit: 300, windowMs: 60_000, by: 'user' }),
    requireIdempotencyKey(),
    validate(
      z
        .object({
          roomId: z.string().uuid(),
          recipientId: z.string().uuid(),
          giftId: z.string().regex(/^[a-z0-9_]{2,64}$/, 'Invalid gift id'),
          quantity: z
            .number()
            .int()
            .refine((n) => (GIFT_QUANTITIES as readonly number[]).includes(n), {
              message: 'Quantity must be 1, 10, 99, 520 or 999',
            }),
          // The unit price the user saw. Bounded to the catalog's range so a
          // nonsense value is refused as nonsense, not as a price change.
          expectedCoinPrice: z.number().int().min(1).max(10_000_000),
        })
        .strict(),
    ),
    async (req, res, next) => {
      try {
        res.json(
          await sendGift({
            senderId: req.userId!,
            roomId: req.body.roomId,
            recipientId: req.body.recipientId,
            giftId: req.body.giftId,
            quantity: req.body.quantity as GiftQuantity,
            expectedCoinPrice: req.body.expectedCoinPrice,
            idempotencyKey: req.idempotencyKey!,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // The room leaderboard
  //
  // Readable without a session, like the room itself: who is backing a host
  // is part of what a room IS to someone deciding whether to join it.
  // ---------------------------------------------------------------------
  router.get(
    '/leaderboard/:roomId',
    optionalAuth(),
    validate({ params: z.object({ roomId: z.string().uuid() }).strict() }),
    async (req, res, next) => {
      try {
        const { roomId } = req.validatedParams as { roomId: string };
        res.json({ leaderboard: await roomLeaderboard(roomId) });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
