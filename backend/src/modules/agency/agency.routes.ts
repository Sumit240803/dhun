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
import { createAgency, setCoinTrading } from './agency.admin.js';
import { agencyDetail, auditTransfers, listAgencies, setAgencyStatus } from './admin.service.js';
import {
  agencyAgentInvites,
  agentHosts,
  answerAgentInvite,
  cancelAgentInvite,
  inviteAgent,
  listAgents,
  myAgentInvites,
  removeAgent,
  setAgentManagement,
} from './agents.service.js';
import {
  agencyTransfers,
  confirmPrepay,
  inventory,
  listPrepays,
  receivedTransfers,
  recordPrepay,
  rejectPrepay,
  transfer,
} from './coins.service.js';
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
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).strict();
const auditQuery = z
  .object({
    agencyId: z.coerce.number().int().min(1).max(99_999_999).optional(),
    userId: z.coerce.number().int().min(1).max(99_999_999).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

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

  // ── Coin trading ──────────────────────────────────────────────────────────
  //
  // Owner only, and only with the coin-trading grant. requireAdult, because
  // these move money like every other money endpoint.

  router.get('/inventory', requireAdult(), readLimit, async (req, res, next) => {
    try {
      res.json(await inventory(req.userId!));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/transfers',
    requireAdult(),
    // Deliberately tighter than the other writes: this is the one endpoint in
    // the module that moves currency.
    rateLimit({ scope: 'agency:transfer', limit: 60, windowMs: 60_000, by: 'user' }),
    validate(
      z
        .object({
          userId: publicId,
          coins: z.number().int().min(1).max(100_000_000),
          // Generated once per transfer by the client; a retry reuses it and
          // the ledger collapses the duplicate.
          requestId: z.string().uuid(),
          note: z.string().trim().min(1).max(140).optional(),
        })
        .strict(),
    ),
    async (req, res, next) => {
      try {
        res.status(201).json({
          transfer: await transfer(req.userId!, {
            recipientPublicId: req.body.userId,
            coins: req.body.coins,
            requestId: req.body.requestId,
            note: req.body.note,
          }),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/transfers', readLimit, validate({ query: limitQuery }), async (req, res, next) => {
    try {
      res.json({ transfers: await agencyTransfers(req.userId!, Number(req.query.limit ?? 50)) });
    } catch (err) {
      next(err);
    }
  });

  /** The user's own side of the record — coins they were sent, and by whom. */
  router.get('/received', readLimit, validate({ query: limitQuery }), async (req, res, next) => {
    try {
      res.json({ transfers: await receivedTransfers(req.userId!, Number(req.query.limit ?? 50)) });
    } catch (err) {
      next(err);
    }
  });

  // ── Agents ────────────────────────────────────────────────────────────────
  //
  // For whoever holds agent management — the agency owner, and any sub-agent
  // they have granted it to. Answering an invitation needs none of that, since
  // the person answering is not in the agency yet.

  router.get('/agents', readLimit, async (req, res, next) => {
    try {
      res.json({ agents: await listAgents(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  /** Both sides' view: what the caller was offered, and what this agency offered. */
  router.get('/agents/invites', readLimit, async (req, res, next) => {
    try {
      const mine = await myAgentInvites(req.userId!);
      // Only an agency manager has outgoing ones; not being one is not an error.
      const sent = await agencyAgentInvites(req.userId!).catch(() => []);
      res.json({ mine, sent });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/agents/invites',
    writeLimit,
    validate(
      z.object({ userId: publicId, canManageAgents: z.boolean().optional(), message }).strict(),
    ),
    async (req, res, next) => {
      try {
        res.status(201).json({
          invite: await inviteAgent(req.userId!, {
            invitedPublicId: req.body.userId,
            canManageAgents: req.body.canManageAgents,
            message: req.body.message,
          }),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/agents/invites/:id/accept',
    requireAdult(),
    writeLimit,
    validate(idParam),
    async (req, res, next) => {
      try {
        res.json({ invite: await answerAgentInvite(req.userId!, req.params.id, true) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/agents/invites/:id/decline',
    writeLimit,
    validate(idParam),
    async (req, res, next) => {
      try {
        res.json({ invite: await answerAgentInvite(req.userId!, req.params.id, false) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/agents/invites/:id/cancel',
    writeLimit,
    validate(idParam),
    async (req, res, next) => {
      try {
        res.json({ invite: await cancelAgentInvite(req.userId!, req.params.id) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/agents/:id/hosts', readLimit, validate(idParam), async (req, res, next) => {
    try {
      res.json({ hosts: await agentHosts(req.userId!, req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  /** Removing an agent moves their hosts to the owner — never off the platform. */
  router.post('/agents/:id/remove', writeLimit, validate(idParam), async (req, res, next) => {
    try {
      res.json(await removeAgent(req.userId!, req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/agents/:id/management',
    writeLimit,
    validate({
      params: z.object({ id: z.string().uuid() }).strict(),
      body: z.object({ canManageAgents: z.boolean() }).strict(),
    }),
    async (req, res, next) => {
      try {
        res.json({
          agent: await setAgentManagement(req.userId!, req.params.id, req.body.canManageAgents),
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

  const adminWriteLimit = rateLimit({
    scope: 'admin:agency:write',
    limit: 120,
    windowMs: 3_600_000,
    by: 'user',
  });

  router.post(
    '/',
    adminWriteLimit,
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

  /**
   * The coin-trading grant, on its own.
   *
   * Separate from creating the agency because buying inventory is where fraud
   * and laundering land: an agency that only manages hosts should never be
   * able to move currency by default.
   */
  router.post(
    '/:id/coin-trading',
    adminWriteLimit,
    validate({
      params: z.object({ id: z.string().uuid() }).strict(),
      body: z.object({ enabled: z.boolean() }).strict(),
    }),
    async (req, res, next) => {
      try {
        res.json({
          agency: await setCoinTrading(req.userId!, req.params.id, req.body.enabled),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/',
    validate({
      query: z
        .object({
          status: z.enum(['active', 'suspended', 'closed']).optional(),
          q: z.string().trim().min(1).max(60).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        })
        .strict(),
    }),
    async (req, res, next) => {
      try {
        res.json({
          agencies: await listAgencies({
            status: req.query.status as 'active' | 'suspended' | 'closed' | undefined,
            query: req.query.q as string | undefined,
            limit: Number(req.query.limit ?? 50),
          }),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * The transfer audit.
   *
   * Somebody paid an agency off-platform and says the coins never arrived. We
   * never saw that payment, so what the agency did or did not send is the only
   * thing we can establish — searchable from either side's public ID.
   */
  router.get('/transfers', validate({ query: auditQuery }), async (req, res, next) => {
    try {
      res.json({
        transfers: await auditTransfers({
          agencyPublicId: req.query.agencyId ? Number(req.query.agencyId) : undefined,
          userPublicId: req.query.userId ? Number(req.query.userId) : undefined,
          limit: Number(req.query.limit ?? 50),
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Suspension. Blunt on purpose: a suspended agency loses coin trading, host
   * recruitment and agent management at once. Its hosts keep earning, and its
   * inventory is untouched — they paid for it.
   */
  router.post(
    '/:id/status',
    adminWriteLimit,
    validate({
      params: z.object({ id: z.string().uuid() }).strict(),
      body: z
        .object({
          status: z.enum(['active', 'suspended', 'closed']),
          reason: z.string().trim().min(1).max(500),
        })
        .strict(),
    }),
    async (req, res, next) => {
      try {
        res.json({
          agency: await setAgencyStatus(
            req.userId!,
            req.params.id,
            req.body.status,
            req.body.reason,
          ),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Prepay, maker-checker ─────────────────────────────────────────────────

  router.post(
    '/prepays',
    adminWriteLimit,
    validate(
      z
        .object({
          agencyId: publicId,
          amountPaise: z.number().int().min(1).max(10_000_000_000),
          method: z.enum(['bank_transfer', 'upi', 'gateway']),
          paymentReference: z.string().trim().min(4).max(64),
        })
        .strict(),
    ),
    async (req, res, next) => {
      try {
        res.status(201).json({
          prepay: await recordPrepay(req.userId!, {
            agencyPublicId: req.body.agencyId,
            amountPaise: req.body.amountPaise,
            method: req.body.method,
            paymentReference: req.body.paymentReference,
          }),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/prepays',
    validate({
      query: z
        .object({
          status: z.enum(['pending', 'confirmed', 'rejected']).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        })
        .strict(),
    }),
    async (req, res, next) => {
      try {
        res.json({
          prepays: await listPrepays({
            status: req.query.status as 'pending' | 'confirmed' | 'rejected' | undefined,
            limit: Number(req.query.limit ?? 50),
          }),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /** The checker. The database refuses the admin who recorded it. */
  router.post(
    '/prepays/:id/confirm',
    adminWriteLimit,
    validate(idParam),
    async (req, res, next) => {
      try {
        res.json({ prepay: await confirmPrepay(req.userId!, req.params.id) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/prepays/:id/reject',
    adminWriteLimit,
    validate({
      params: z.object({ id: z.string().uuid() }).strict(),
      body: z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
    }),
    async (req, res, next) => {
      try {
        res.json({
          prepay: await rejectPrepay(req.userId!, req.params.id, req.body.reason),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // Registered LAST: a one-segment pattern would otherwise swallow
  // GET /prepays and GET /transfers before either is reached.
  router.get('/:id', validate(idParam), async (req, res, next) => {
    try {
      res.json({ agency: await agencyDetail(req.params.id) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
