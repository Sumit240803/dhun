import { Router } from 'express';
import { optionalAuth } from '../../middleware/authGuard.js';
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

  return router;
}
