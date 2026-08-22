import { Router } from 'express';
import { z } from 'zod';
import { authGuard, requireAdult, requireRegistered } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { validate } from '../../middleware/validate.js';
import { purchaseViaIap, purchaseViaWeb, listPurchases } from '../payments/index.js';
import { listCoinPacks } from './catalog.service.js';
import { convertCoinsToGems, getWallet, listTransactions } from './wallet.service.js';

export function buildWalletRouter(): Router {
  const router = Router();

  // Everything here is either about a user's own money or spends it.
  router.use(authGuard());

  router.get('/', async (req, res, next) => {
    try {
      res.json({ wallet: await getWallet(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  // Server-driven, so a price change or a new pack never needs an app release.
  router.get('/packs', async (_req, res, next) => {
    try {
      res.json({ packs: await listCoinPacks() });
    } catch (err) {
      next(err);
    }
  });

  // Query params are validated like any other input: bounded limit, uuid cursor,
  // and unknown keys rejected rather than ignored.
  router.get(
    '/transactions',
    validate({
      query: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        before: z.string().uuid().optional(),
      }),
    }),
    async (req, res, next) => {
      try {
        const { limit, before } = req.validatedQuery as { limit: number; before?: string };
        res.json({ transactions: await listTransactions(req.userId!, { limit, before }) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/purchases', async (req, res, next) => {
    try {
      res.json({ purchases: await listPurchases(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  // --- money endpoints: registered users only, Idempotency-Key required -------

  router.post(
    '/purchase/iap',
    requireRegistered(),
    requireAdult(),
    rateLimit({ scope: 'money', limit: 30, windowMs: 60_000, by: 'user' }),
    requireIdempotencyKey(),
    validate(
      z.object({
        packId: z.string().regex(/^[a-z0-9_]{2,64}$/, 'Invalid pack id'),
        purchaseToken: z.string().min(8).max(4096),
      }),
    ),
    async (req, res, next) => {
      try {
        res.json(
          await purchaseViaIap({
            userId: req.userId!,
            packId: req.body.packId,
            purchaseToken: req.body.purchaseToken,
            idempotencyKey: req.idempotencyKey!,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/purchase/web',
    requireRegistered(),
    requireAdult(),
    rateLimit({ scope: 'money', limit: 30, windowMs: 60_000, by: 'user' }),
    requireIdempotencyKey(),
    validate(
      z.object({
        packId: z.string().regex(/^[a-z0-9_]{2,64}$/, 'Invalid pack id'),
        orderId: z.string().regex(/^[A-Za-z0-9_-]{4,128}$/, 'Invalid order id'),
        paymentId: z.string().regex(/^[A-Za-z0-9_-]{4,128}$/, 'Invalid payment id'),
        // Razorpay signs with HMAC-SHA256, so the signature is always 64 hex chars.
        signature: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid signature'),
      }),
    ),
    async (req, res, next) => {
      try {
        res.json(
          await purchaseViaWeb({
            userId: req.userId!,
            packId: req.body.packId,
            orderId: req.body.orderId,
            paymentId: req.body.paymentId,
            signature: req.body.signature,
            idempotencyKey: req.idempotencyKey!,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/convert',
    requireRegistered(),
    requireAdult(),
    rateLimit({ scope: 'money', limit: 30, windowMs: 60_000, by: 'user' }),
    requireIdempotencyKey(),
    // Upper bound as well as lower: an absurd amount should be refused as
    // nonsense before it ever reaches a balance check.
    validate(z.object({ coins: z.number().int().min(1).max(100_000_000) })),
    async (req, res, next) => {
      try {
        res.json(
          await convertCoinsToGems({
            userId: req.userId!,
            coins: req.body.coins,
            idempotencyKey: req.idempotencyKey!,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
