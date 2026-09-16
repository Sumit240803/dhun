import { Router } from 'express';
import { z } from 'zod';
import { authGuard, requireAdult, requireRegistered } from '../../middleware/authGuard.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { WEARABLE_KINDS } from '../../shared/cosmeticStyle.js';
import {
  equipCosmetic,
  listOwned,
  purchaseCosmetic,
  unequipKind,
} from './cosmetics.service.js';

const cosmeticId = z.string().regex(/^[a-z0-9_]{2,64}$/, 'Invalid item id');

export function buildCosmeticsRouter(): Router {
  const router = Router();

  // Everything here is about the caller's own things. The catalog itself is
  // public and lives at /v1/catalog/cosmetics.
  router.use(authGuard());

  router.get('/mine', async (req, res, next) => {
    try {
      res.json({ items: await listOwned(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  // A money endpoint: gems are bought with real money, so spending them gets
  // the same gates as spending coins.
  router.post(
    '/purchase',
    requireRegistered(),
    requireAdult(),
    rateLimit({ scope: 'money', limit: 30, windowMs: 60_000, by: 'user' }),
    requireIdempotencyKey(),
    validate(
      z
        .object({
          cosmeticId,
          // The price the store displayed. A repriced item is refused, never
          // charged at a number the user did not see.
          expectedGemPrice: z.number().int().min(1).max(100_000_000),
        })
        .strict(),
    ),
    async (req, res, next) => {
      try {
        res.json(
          await purchaseCosmetic({
            userId: req.userId!,
            cosmeticId: req.body.cosmeticId,
            expectedGemPrice: req.body.expectedGemPrice,
            idempotencyKey: req.idempotencyKey!,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  // Equipping moves no money, so no idempotency key: doing it twice is the
  // same as doing it once.
  router.post(
    '/equip',
    rateLimit({ scope: 'cosmetics:equip', limit: 60, windowMs: 60_000, by: 'user' }),
    validate(z.object({ cosmeticId }).strict()),
    async (req, res, next) => {
      try {
        res.json({ items: await equipCosmetic(req.userId!, req.body.cosmeticId) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/unequip',
    rateLimit({ scope: 'cosmetics:equip', limit: 60, windowMs: 60_000, by: 'user' }),
    validate(z.object({ kind: z.enum(WEARABLE_KINDS as [string, ...string[]]) }).strict()),
    async (req, res, next) => {
      try {
        res.json({ items: await unequipKind(req.userId!, req.body.kind) });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
