import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../infra/errors.js';
import { authGuard, requireRegistered } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { pkConfig } from './pk.config.js';
import {
  acceptInvite,
  battleForRoom,
  byId,
  declineInvite,
  inbox,
  invite,
  joinQueue,
  leaveQueue,
  settle,
} from './pk.service.js';

const uuid = z.string().uuid();

/**
 * PK battles.
 *
 * ── No money endpoint here, and that is the point ───────────────────────────
 *
 * Nothing in this router takes an `Idempotency-Key`, because nothing in it
 * moves coins. A battle reads gifts that `gifting` has already settled. If a
 * route is ever added here that needs an idempotency key, that is the signal
 * that somebody is about to settle a wager — see migration 028's header and
 * hard rule #1.
 *
 * ── Registered adults only ──────────────────────────────────────────────────
 *
 * `requireRegistered` rather than the 18+ money gate: PK spends nothing. But a
 * guest cannot host, so every action here is unreachable for one anyway, and
 * the guard produces a sentence instead of a confusing `NOT_LIVE`.
 */
export function buildPkRouter(): Router {
  const router = Router();
  router.use(authGuard(), requireRegistered());

  /** The dials the app needs — mostly to know whether to show the button. */
  router.get('/config', async (_req, res, next) => {
    try {
      const config = await pkConfig();
      res.json({
        enabled: config.enabled,
        durationSeconds: config.durationSeconds,
        minDurationSeconds: config.minDurationSeconds,
        maxDurationSeconds: config.maxDurationSeconds,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * The battle a room is in, if any.
   *
   * Read by anyone who can see the room — a viewer arriving mid-battle needs
   * the bar as much as the hosts do.
   */
  router.get(
    '/rooms/:roomId',
    validate({ params: z.object({ roomId: uuid }).strict() }),
    async (req, res, next) => {
      try {
        res.json({ pk: await battleForRoom(req.params.roomId) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/battles/:battleId',
    validate({ params: z.object({ battleId: uuid }).strict() }),
    async (req, res, next) => {
      try {
        res.json({ pk: await byId(req.params.battleId) });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Invitations ─────────────────────────────────────────────────────────

  router.get('/invites', async (req, res, next) => {
    try {
      res.json({ invites: await inbox(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Invite another host.
   *
   * Rate-limited hard and per USER, not per IP. An invitation puts a dialog in
   * front of somebody who is mid-broadcast, which makes it the most
   * harassment-shaped endpoint in this module — and the partial unique index
   * already stops a second one to the same host while the first is pending.
   */
  router.post(
    '/invites',
    rateLimit({ scope: 'pk:invite', limit: 20, windowMs: 600_000, by: 'user' }),
    validate(z.object({ toUserId: uuid }).strict()),
    async (req, res, next) => {
      try {
        res.status(201).json(await invite({ fromUserId: req.userId!, toUserId: req.body.toUserId }));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/invites/:inviteId/accept',
    rateLimit({ scope: 'pk:accept', limit: 30, windowMs: 600_000, by: 'user' }),
    validate({
      params: z.object({ inviteId: uuid }).strict(),
      // The window is the accepting host's choice: they are the one agreeing
      // to be on camera for it. Clamped to config's min and max in the service.
      body: z.object({ durationSeconds: z.number().int().min(30).max(3_600).optional() }).strict(),
    }),
    async (req, res, next) => {
      try {
        res.json({
          pk: await acceptInvite({
            inviteId: req.params.inviteId,
            userId: req.userId!,
            durationSeconds: req.body.durationSeconds,
          }),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/invites/:inviteId/decline',
    validate({ params: z.object({ inviteId: uuid }).strict() }),
    async (req, res, next) => {
      try {
        await declineInvite(req.params.inviteId, req.userId!);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Random matchmaking ──────────────────────────────────────────────────

  router.post(
    '/queue',
    rateLimit({ scope: 'pk:queue', limit: 30, windowMs: 600_000, by: 'user' }),
    async (req, res, next) => {
      try {
        res.json(await joinQueue(req.userId!));
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/queue', async (req, res, next) => {
    try {
      await leaveQueue(req.userId!);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // ── Ending early ────────────────────────────────────────────────────────

  /**
   * Give up.
   *
   * Settles on the scores AS THEY STAND rather than voiding the battle. The
   * other side's audience spent real money on a bar that was real while it was
   * moving, and erasing it because somebody quit is how you lose both
   * audiences at once. Forfeiting while behind therefore loses; forfeiting
   * while ahead still wins, which is correct — they earned it.
   */
  router.post(
    '/battles/:battleId/forfeit',
    rateLimit({ scope: 'pk:forfeit', limit: 20, windowMs: 600_000, by: 'user' }),
    validate({ params: z.object({ battleId: uuid }).strict() }),
    async (req, res, next) => {
      try {
        const battle = await byId(req.params.battleId);
        const isCompetitor = battle.sides.some((side) => side.userId === req.userId);
        // Thrown, not written: the error handler owns the envelope, and a
        // hand-rolled one here would be the single response in the app whose
        // shape the client's error mapper does not understand.
        if (!isCompetitor) throw new AppError('PK_NOT_YOURS', 'That is not your battle', 403);
        res.json({ pk: (await settle(req.params.battleId, 'host_left')) ?? battle });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
