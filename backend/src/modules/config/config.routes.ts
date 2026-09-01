import { Router } from 'express';
import { optionalAuth } from '../../middleware/authGuard.js';
import { getClientConfig } from './appConfig.service.js';
import { listBanners } from './banners.service.js';

export function buildConfigRouter(): Router {
  const router = Router();

  // Readable without a session: the feed renders before sign-in, and the
  // banners are part of what the app looks like to someone deciding whether
  // to join at all.
  router.use(optionalAuth());

  router.get('/banners', async (_req, res, next) => {
    try {
      res.json({ banners: await listBanners() });
    } catch (err) {
      next(err);
    }
  });

  // Fetched on every launch and on resume, BEFORE the first screen renders.
  // Anonymous on purpose: a force-update has to reach a user who cannot sign
  // in, which is exactly the situation a broken auth release creates.
  router.get('/app', async (_req, res, next) => {
    try {
      res.json({ config: await getClientConfig() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
