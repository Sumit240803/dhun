import { Router } from 'express';
import { optionalAuth } from '../../middleware/authGuard.js';
import { listCosmetics, listGifts } from './catalog.service.js';

/**
 * The server-driven catalogs.
 *
 * optionalAuth rather than authGuard: the app fetches these on launch, before a
 * guest session necessarily exists, and browsing prices needs no identity.
 */
export function buildCatalogRouter(): Router {
  const router = Router();
  router.use(optionalAuth());

  router.get('/gifts', async (_req, res, next) => {
    try {
      res.json({ gifts: await listGifts() });
    } catch (err) {
      next(err);
    }
  });

  router.get('/cosmetics', async (_req, res, next) => {
    try {
      res.json({ cosmetics: await listCosmetics() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
