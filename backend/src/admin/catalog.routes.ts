// The catalog pages, mounted at /admin/catalog.
//
// Forms arrive as strings. Each handler turns them into the exact object the
// service validates with the same zod schema the READING code uses, so the
// panel cannot save a dial the service would then throw away.

import { Router, type Response } from 'express';
import { AppError, mapDatabaseError } from '../infra/errors.js';
import {
  adminGifts,
  adminPacks,
  dial,
  isDialKey,
  setDial,
  updateGift,
  updatePack,
} from '../modules/config/index.js';
import { html } from './html.js';
import { flash, page } from './layout.js';
import { asFlag, asInt, asText, CAN_EDIT_CATALOG, nav } from './nav.js';
import { catalogPage } from './pages.catalog.js';
import { requireCsrf, requireRoles } from './session.js';

function back(res: Response, err: unknown): void {
  const refusal = err instanceof AppError ? err : mapDatabaseError(err);
  if (refusal && refusal.status < 500) {
    res.redirect(`/admin/catalog?err=${encodeURIComponent(refusal.message)}`);
    return;
  }
  throw err;
}

/** A required whole number from a form field, or a 422 naming the field. */
function need(value: unknown, field: string): number {
  const n = asInt(value);
  if (n === undefined || Number.isNaN(n)) {
    throw new AppError('BAD_INPUT', `${field} must be a whole number`, 422);
  }
  return n;
}

/** Rupees typed with or without paise, to paise. */
function rupeesToPaise(value: unknown, field: string): number {
  const text = asText(value).trim().replace(/[,₹\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new AppError('BAD_INPUT', `${field} must be an amount in rupees`, 422);
  }
  return Math.round(Number(text) * 100);
}

export function buildCatalogPages(): Router {
  const router = Router();
  router.use(requireRoles(...CAN_EDIT_CATALOG));

  router.get('/', async (req, res, next) => {
    try {
      const [gifts, packs, freeCoins, newUser, coldStart] = await Promise.all([
        adminGifts(),
        adminPacks(),
        dial('free_coins'),
        dial('new_user_rewards'),
        dial('cold_start'),
      ]);
      res.type('html').send(
        page(
          await nav(req, 'catalog'),
          'Catalog',
          html`${flash(asText(req.query.ok))}${flash(asText(req.query.err), 'err')}
            ${catalogPage({ gifts, packs, freeCoins, newUser, coldStart, csrf: req.staff!.csrf })}`,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.post('/gift', requireCsrf, async (req, res, next) => {
    try {
      try {
        const id = asText(req.body.id);
        await updateGift({
          id,
          coinPrice: need(req.body.coinPrice, 'Price'),
          payoutRateBp: need(req.body.payoutRateBp, 'Payout'),
          isActive: asFlag(req.body.isActive),
          actorId: req.staff!.userId,
          reason: asText(req.body.reason),
        });
        res.redirect('/admin/catalog?ok=' + encodeURIComponent(`Gift ${id} saved.`));
      } catch (err) {
        back(res, err);
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/pack', requireCsrf, async (req, res, next) => {
    try {
      try {
        const id = asText(req.body.id);
        await updatePack({
          id,
          pricePaise: rupeesToPaise(req.body.rupees, 'Price'),
          coins: need(req.body.coins, 'Coins'),
          gems: need(req.body.gems, 'Gems'),
          isActive: asFlag(req.body.isActive),
          actorId: req.staff!.userId,
          reason: asText(req.body.reason),
        });
        res.redirect('/admin/catalog?ok=' + encodeURIComponent(`Pack ${id} saved.`));
      } catch (err) {
        back(res, err);
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/dial/:key', requireCsrf, async (req, res, next) => {
    try {
      try {
        const key = req.params.key;
        if (!isDialKey(key)) throw new AppError('BAD_ACTION', 'Unknown setting', 422);
        const b = req.body as Record<string, unknown>;

        const value =
          key === 'free_coins'
            ? {
                signup: need(b.signup, 'Welcome bonus'),
                checkinLadder: asText(b.checkinLadder)
                  .split(',')
                  .map((part) => need(part, 'Check-in ladder')),
                watch: {
                  coins: need(b.watchCoins, 'Watch reward'),
                  minutes: need(b.watchMinutes, 'Interval'),
                  dailyCap: need(b.watchDailyCap, 'Intervals per day'),
                },
                referral: {
                  coins: need(b.referralCoins, 'Referral reward'),
                  minPurchasePaise: rupeesToPaise(b.referralMinRupees, 'Friend’s first purchase'),
                  attachWindowDays: need(b.referralAttachWindowDays, 'Code window'),
                },
              }
            : key === 'new_user_rewards'
              ? {
                  windowDays: need(b.windowDays, 'Window'),
                  tasks: {
                    follow: need(b.follow, 'First follow'),
                    gift: need(b.gift, 'First gift'),
                    chat: need(b.chat, 'First message'),
                  },
                }
              : {
                  maxFeedRooms:
                    asText(b.maxFeedRooms).trim() === '' ? null : need(b.maxFeedRooms, 'Rooms per feed'),
                  hideViewerCounts: asFlag(b.hideViewerCounts),
                  peakStartIst: asText(b.peakStartIst).trim(),
                  peakEndIst: asText(b.peakEndIst).trim(),
                  dropNewUsersIntoRoom: asFlag(b.dropNewUsersIntoRoom),
                };

        await setDial({ key, value, actorId: req.staff!.userId, reason: asText(b.reason) });
        res.redirect('/admin/catalog?ok=' + encodeURIComponent('Saved.'));
      } catch (err) {
        back(res, err);
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}
