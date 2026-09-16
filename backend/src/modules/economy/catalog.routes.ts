import { Router } from 'express';
import { optionalAuth } from '../../middleware/authGuard.js';
import { getConfigNumber, listCosmetics, listGifts } from './catalog.service.js';
import { ECONOMY } from './rates.js';

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
      const [cosmetics, rateBp, minimumCoins] = await Promise.all([
        listCosmetics(),
        getConfigNumber('coin_to_gem_rate_bp', ECONOMY.coinToGemRateBp),
        getConfigNumber('min_conversion_coins', 100),
      ]);
      // The conversion terms travel with the store, because the store is where
      // someone short of gems decides whether to convert — and a client that
      // guessed the rate would show a number the server then contradicts.
      res.json({ cosmetics, conversion: { coinToGemRateBp: rateBp, minimumCoins } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
