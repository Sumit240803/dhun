// What the app reports about itself.
//
// Sentry (mobile/src/lib/reporting.ts) is the crash reporter and stays. This
// is the copy WE keep: the same reports, with the trace id from the API error
// envelope, landing in the same table as the server's own errors — so one
// screen shows "the gift failed in the app" next to "the gift failed on the
// server" for the same trace.
//
// Hostile by default, like every endpoint. Guests may post (a crash before
// sign-in is the one most worth hearing about), so the limits are by address
// and the batch is small. Nothing here is trusted: the event name is a
// constrained token, every string is capped, and `meta` is primitives only.
// Whatever comes in is sanitised again on the way to the table.

import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../../middleware/authGuard.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { recordEvent } from '../../infra/eventLog.js';

const token = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_.:-]+$/, 'Letters, digits, dot, dash, underscore and colon only');

const primitive = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);

const clientEvent = z
  .object({
    level: z.enum(['info', 'warn', 'error']),
    event: token(64),
    message: z.string().max(500).optional(),
    code: token(64).optional(),
    screen: z.string().max(64).optional(),
    traceId: token(64).optional(),
    stack: z.string().max(2_000).optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    meta: z.record(z.string().max(64), primitive).refine((m) => Object.keys(m).length <= 20, {
      message: 'Too many keys',
    }).optional(),
  })
  .strict();

const body = z
  .object({
    app: z
      .object({
        version: z.string().max(32),
        build: z.string().max(16).optional(),
        platform: z.enum(['android', 'ios', 'web']),
        env: z.enum(['development', 'staging', 'production']).optional(),
      })
      .strict(),
    events: z.array(clientEvent).min(1).max(20),
  })
  .strict();

/** A timestamp the client claims is accepted only if it is recent and not in the future. */
function plausibleTime(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const at = new Date(iso).getTime();
  const now = Date.now();
  if (!Number.isFinite(at) || at > now + 60_000 || at < now - 7 * 24 * 3_600_000) return undefined;
  return new Date(at);
}

export function buildTelemetryRouter(): Router {
  const router = Router();
  router.use(optionalAuth());

  router.post(
    '/events',
    rateLimit({ scope: 'client:events', limit: 60, windowMs: 60_000, by: 'ip+user' }),
    validate(body),
    (req, res) => {
      const { app, events } = req.body as z.infer<typeof body>;

      for (const e of events) {
        recordEvent({
          level: e.level,
          kind: 'app',
          process: 'app',
          event: `app.${e.event}`,
          message: e.message,
          code: e.code,
          traceId: e.traceId ?? null,
          userId: req.userId ?? null,
          path: e.screen ? `screen ${e.screen}` : null,
          occurredAt: plausibleTime(e.occurredAt),
          meta: {
            app,
            ...(e.stack ? { stack: e.stack } : {}),
            ...(e.meta ?? {}),
          },
        });
      }

      // Accepted, not "stored": the write is batched and asynchronous, and the
      // app has nothing to do with the answer except stop retrying.
      res.status(202).json({ accepted: events.length });
    },
  );

  return router;
}
