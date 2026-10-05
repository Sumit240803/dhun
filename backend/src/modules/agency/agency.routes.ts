import { Router } from 'express';
import { z } from 'zod';
import {
  authGuard,
  requireAdult,
  requireRegistered,
  requireStaff,
} from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { createAgency } from './agency.admin.js';
import {
  agentSeat,
  answerRequest,
  applyToAgent,
  applyToQuit,
  cancelRequest,
  currentMembership,
  decideQuit,
  getHostCode,
  inviteHost,
  latestQuitRequest,
  listQuitRequests,
  listRequests,
  rotateHostCode,
} from './agency.service.js';

// Public ids are 8-digit user and agent numbers, and 6-digit-plus agency ones.
const publicId = z.number().int().min(1).max(99_999_999);
const message = z.string().trim().min(1).max(300).optional();
const idParam = { params: z.object({ id: z.string().uuid() }).strict() };

export function buildAgencyRouter(): Router {
  const router = Router();
  router.use(authGuard(), requireRegistered());

  const readLimit = rateLimit({
    scope: 'agency:read',
    limit: 120,
    windowMs: 60_000,
    by: 'user',
  });
  const writeLimit = rateLimit({
    scope: 'agency:write',
    limit: 30,
    windowMs: 60_000,
    by: 'user',
  });

  /** Everything the My Agency screen needs in one call. */
  router.get('/me', readLimit, async (req, res, next) => {
    try {
      const [membership, seat, quitRequest] = await Promise.all([
        currentMembership(req.userId!),
        agentSeat(req.userId!),
        latestQuitRequest(req.userId!),
      ]);
      res.json({ membership, seat, quitRequest });
    } catch (err) {
      next(err);
    }
  });

  router.get('/host-code', readLimit, async (req, res, next) => {
    try {
      res.json(await getHostCode(req.userId!));
    } catch (err) {
      next(err);
    }
  });

  router.post('/host-code/rotate', writeLimit, async (req, res, next) => {
    try {
      res.json(await rotateHostCode(req.userId!));
    } catch (err) {
      next(err);
    }
  });

  // Hard rule #5: a minor host is an existential risk, so joining is 18+.
  router.post(
    '/join',
    requireAdult(),
    writeLimit,
    validate(z.object({ agentId: publicId, message }).strict()),
    async (req, res, next) => {
      try {
        res.status(201).json({
          request: await applyToAgent(req.userId!, req.body.agentId, req.body.message),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/invites',
    requireAdult(),
    // Low, per user AND per IP: guessing Host Codes is the abuse this guards.
    rateLimit({
      scope: 'agency:invite',
      limit: 20,
      windowMs: 3_600_000,
      by: 'user',
    }),
    rateLimit({
      scope: 'agency:invite:ip',
      limit: 60,
      windowMs: 3_600_000,
      by: 'ip',
    }),
    validate(
      z
        .object({
          userId: publicId,
          hostCode: z
            .string()
            .trim()
            .regex(/^[A-Za-z2-9]{6}$/, 'Must be 6 letters or digits'),
          message,
        })
        .strict(),
    ),
    async (req, res, next) => {
      try {
        res.status(201).json({
          request: await inviteHost(
            req.userId!,
            req.body.userId,
            req.body.hostCode,
            req.body.message,
          ),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/requests', readLimit, async (req, res, next) => {
    try {
      res.json(await listRequests(req.userId!));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/requests/:id/accept',
    requireAdult(),
    writeLimit,
    validate(idParam),
    async (req, res, next) => {
      try {
        res.json(await answerRequest(req.userId!, req.params.id, true));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/requests/:id/decline', writeLimit, validate(idParam), async (req, res, next) => {
    try {
      res.json(await answerRequest(req.userId!, req.params.id, false));
    } catch (err) {
      next(err);
    }
  });

  router.post('/requests/:id/cancel', writeLimit, validate(idParam), async (req, res, next) => {
    try {
      res.json({ request: await cancelRequest(req.userId!, req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/quit',
    writeLimit,
    validate(z.object({ reason: z.string().trim().min(1).max(100) }).strict()),
    async (req, res, next) => {
      try {
        res.json(await applyToQuit(req.userId!, req.body.reason));
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/quit-requests', readLimit, async (req, res, next) => {
    try {
      res.json({ requests: await listQuitRequests(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/quit-requests/:id/approve',
    writeLimit,
    validate(idParam),
    async (req, res, next) => {
      try {
        res.json({
          request: await decideQuit(req.userId!, req.params.id, true),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/quit-requests/:id/reject',
    writeLimit,
    validate(idParam),
    async (req, res, next) => {
      try {
        res.json({
          request: await decideQuit(req.userId!, req.params.id, false),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

/** Back office. Mounted at /v1/admin/agencies. */
export function buildAgencyAdminRouter(): Router {
  const router = Router();
  router.use(authGuard(), requireStaff(['super_admin', 'ops_manager']));

  router.post(
    '/',
    rateLimit({
      scope: 'admin:agency:create',
      limit: 30,
      windowMs: 3_600_000,
      by: 'user',
    }),
    validate(
      z
        .object({
          ownerUserId: publicId,
          name: z.string().trim().min(2).max(60),
          contactEmail: z.string().trim().email().max(254).optional(),
          isHouse: z.boolean().optional(),
        })
        .strict(),
    ),
    async (req, res, next) => {
      try {
        const seat = await createAgency(req.userId!, {
          ownerPublicId: req.body.ownerUserId,
          name: req.body.name,
          contactEmail: req.body.contactEmail,
          isHouse: req.body.isHouse,
        });
        res.status(201).json({ agency: seat.agency, ownerSeat: seat });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
