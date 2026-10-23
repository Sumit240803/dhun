// The agency back office, as a router mounted at /admin/agencies.
//
// Every write here already exists as a JSON endpoint under /v1/admin/agencies
// with the same roles; these pages call the same service functions, so there
// is one set of rules however the back office is driven.

import { Router, type Response } from 'express';
import { AppError, mapDatabaseError } from '../infra/errors.js';
import {
  agencyDetail,
  auditTransfers,
  channelConfig,
  confirmPrepay,
  createAgency,
  listAgencies,
  listPrepays,
  recordPrepay,
  rejectPrepay,
  setAgencyStatus,
  setCoinTrading,
} from '../modules/agency/index.js';
import { html } from './html.js';
import { flash, page } from './layout.js';
import { asFlag, asInt, asText, CAN_MANAGE_AGENCIES, nav } from './nav.js';
import { agenciesPage, agencyPage } from './pages.agencies.js';
import { requireCsrf, requireRoles } from './session.js';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * A refusal the operator can act on — a bad ID, a prepay already decided, the
 * maker trying to be the checker — goes back to the page as a banner. Anything
 * else is a real failure and takes the ordinary error path.
 */
function back(res: Response, path: string, err: unknown): void {
  const refusal = err instanceof AppError ? err : mapDatabaseError(err);
  if (refusal && refusal.status < 500) {
    res.redirect(`${path}?err=${encodeURIComponent(refusal.message)}`);
    return;
  }
  throw err;
}

export function buildAgencyPages(): Router {
  const router = Router();
  router.use(requireRoles(...CAN_MANAGE_AGENCIES));

  router.get('/', async (req, res, next) => {
    try {
      const query = asText(req.query.q).trim();
      const status = asText(req.query.status);
      const userQuery = asText(req.query.userId).trim();
      const userPublicId = /^\d{1,18}$/.test(userQuery) ? Number(userQuery) : undefined;

      const [agencies, pending, transfers, cfg] = await Promise.all([
        listAgencies({
          query: query || undefined,
          status: ['active', 'suspended', 'closed'].includes(status)
            ? (status as 'active' | 'suspended' | 'closed')
            : undefined,
          limit: 100,
        }),
        listPrepays({ status: 'pending', limit: 50 }),
        userPublicId === undefined ? null : auditTransfers({ userPublicId, limit: 50 }),
        channelConfig(),
      ]);

      res.type('html').send(
        page(
          await nav(req, 'agencies'),
          'Agencies',
          html`${flash(asText(req.query.ok))}${flash(asText(req.query.err), 'err')}
            ${agenciesPage({
              agencies,
              pending,
              transfers,
              query,
              status: ['active', 'suspended', 'closed'].includes(status) ? status : '',
              userQuery,
              csrf: req.staff!.csrf,
              staffId: req.staff!.userId,
              minPrepayRupees: Math.round(cfg.minPrepayPaise / 100),
            })}`,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.post('/create', requireCsrf, async (req, res, next) => {
    try {
      const ownerUserId = asInt(req.body.ownerUserId);
      const name = asText(req.body.name).trim();
      const contactEmail = asText(req.body.contactEmail).trim();
      try {
        if (ownerUserId === undefined || Number.isNaN(ownerUserId) || ownerUserId < 1) {
          throw new AppError('BAD_INPUT', 'The owner’s User ID is a number', 422);
        }
        if (name.length < 2 || name.length > 60) {
          throw new AppError('BAD_INPUT', 'The name is 2 to 60 characters', 422);
        }
        if (contactEmail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
          throw new AppError('BAD_INPUT', 'That email does not look right', 422);
        }
        const seat = await createAgency(req.staff!.userId, {
          ownerPublicId: ownerUserId,
          name,
          contactEmail: contactEmail || undefined,
          isHouse: asFlag(req.body.isHouse),
        });
        res.redirect(`/admin/agencies/${seat.agency.id}?ok=` + encodeURIComponent('Agency created.'));
      } catch (err) {
        back(res, '/admin/agencies', err);
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/prepay', requireCsrf, async (req, res, next) => {
    try {
      const agencyId = asInt(req.body.agencyId);
      const rupees = asInt(req.body.rupees);
      const method = asText(req.body.method);
      try {
        if (agencyId === undefined || Number.isNaN(agencyId)) {
          throw new AppError('BAD_INPUT', 'The Agency ID is a number', 422);
        }
        if (rupees === undefined || Number.isNaN(rupees) || rupees < 1 || rupees > 100_000_000) {
          throw new AppError('BAD_INPUT', 'The amount is a whole number of rupees', 422);
        }
        if (!['bank_transfer', 'upi', 'gateway'].includes(method)) {
          throw new AppError('BAD_INPUT', 'Unknown payment method', 422);
        }
        const prepay = await recordPrepay(req.staff!.userId, {
          agencyPublicId: agencyId,
          amountPaise: rupees * 100,
          method: method as 'bank_transfer' | 'upi' | 'gateway',
          paymentReference: asText(req.body.paymentReference).trim(),
        });
        res.redirect(
          '/admin/agencies?ok=' +
            encodeURIComponent(
              `Recorded ₹${rupees.toLocaleString('en-IN')} for ${prepay.agency.name}. Someone else confirms it.`,
            ),
        );
      } catch (err) {
        back(res, '/admin/agencies', err);
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/prepay/:id/confirm', requireCsrf, async (req, res, next) => {
    try {
      try {
        if (!UUID.test(req.params.id)) throw new AppError('PREPAY_NOT_FOUND', 'That prepay does not exist', 404);
        const prepay = await confirmPrepay(req.staff!.userId, req.params.id);
        res.redirect(
          '/admin/agencies?ok=' +
            encodeURIComponent(`${prepay.coins.toLocaleString('en-IN')} coins minted for ${prepay.agency.name}.`),
        );
      } catch (err) {
        back(res, '/admin/agencies', err);
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/prepay/:id/reject', requireCsrf, async (req, res, next) => {
    try {
      try {
        if (!UUID.test(req.params.id)) throw new AppError('PREPAY_NOT_FOUND', 'That prepay does not exist', 404);
        const reason = asText(req.body.reason).trim();
        if (reason.length < 1) throw new AppError('REASON_REQUIRED', 'Say why — it goes in the record', 422);
        await rejectPrepay(req.staff!.userId, req.params.id, reason.slice(0, 500));
        res.redirect('/admin/agencies?ok=' + encodeURIComponent('Prepay rejected. Nothing was minted.'));
      } catch (err) {
        back(res, '/admin/agencies', err);
      }
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      if (!UUID.test(req.params.id)) throw new AppError('AGENCY_NOT_FOUND', 'That agency does not exist', 404);
      const agency = await agencyDetail(req.params.id);
      const [prepays, transfers] = await Promise.all([
        listPrepays({ agencyId: agency.id, limit: 50 }),
        auditTransfers({ agencyPublicId: agency.publicId, limit: 50 }),
      ]);
      res.type('html').send(
        page(
          await nav(req, 'agencies'),
          agency.name,
          html`${flash(asText(req.query.ok))}${flash(asText(req.query.err), 'err')}
            ${agencyPage({ agency, prepays, transfers, csrf: req.staff!.csrf })}`,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/coin-trading', requireCsrf, async (req, res, next) => {
    try {
      const path = `/admin/agencies/${encodeURIComponent(req.params.id)}`;
      try {
        if (!UUID.test(req.params.id)) throw new AppError('AGENCY_NOT_FOUND', 'That agency does not exist', 404);
        const enabled = req.body.enabled === 'on';
        await setCoinTrading(req.staff!.userId, req.params.id, enabled);
        res.redirect(`${path}?ok=` + encodeURIComponent(enabled ? 'Coin trading granted.' : 'Coin trading withdrawn.'));
      } catch (err) {
        back(res, path, err);
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/status', requireCsrf, async (req, res, next) => {
    try {
      const path = `/admin/agencies/${encodeURIComponent(req.params.id)}`;
      try {
        if (!UUID.test(req.params.id)) throw new AppError('AGENCY_NOT_FOUND', 'That agency does not exist', 404);
        const status = asText(req.body.status);
        if (!['active', 'suspended', 'closed'].includes(status)) {
          throw new AppError('BAD_ACTION', 'Unknown status', 422);
        }
        const reason = asText(req.body.reason).trim();
        if (reason.length < 1) throw new AppError('REASON_REQUIRED', 'Say why — it goes in the record', 422);
        await setAgencyStatus(
          req.staff!.userId,
          req.params.id,
          status as 'active' | 'suspended' | 'closed',
          reason.slice(0, 500),
        );
        res.redirect(`${path}?ok=` + encodeURIComponent(`Now ${status}.`));
      } catch (err) {
        back(res, path, err);
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}
