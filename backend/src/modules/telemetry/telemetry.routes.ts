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
import { plausibleTime, recordAnalytics } from './analytics.service.js';

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
        // Which OTA bundle is running (M21 slice 4): an update id, 'embedded'
        // for the bundle the store build shipped with, or 'development'. A crash
        // that only one update shows is a bad update, and this is how it is seen.
        update: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
        channel: z.string().regex(/^[a-z0-9-]{1,32}$/).optional(),
      })
      .strict(),
    events: z.array(clientEvent).min(1).max(20),
  })
  .strict();

const analyticsEvent = z
  .object({
    // The data plan's object_action, past tense.
    event: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'object_action, lower snake case'),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    sessionId: z.string().max(64).optional(),
    props: z
      .record(z.string().max(64), primitive)
      .refine((m) => Object.keys(m).length <= 30, { message: 'Too many keys' })
      .optional(),
  })
  .strict();

const analyticsBody = z
  .object({
    app: z
      .object({
        version: z.string().max(32),
        platform: z.enum(['android', 'ios', 'web']),
        update: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
      })
      .strict(),
    deviceId: z.string().min(8).max(128).optional(),
    events: z.array(analyticsEvent).min(1).max(50),
  })
  .strict();

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

  // ── Analytics (migration 039) ─────────────────────────────────────────────
  //
  // The typed product events from mobile/src/lib/analytics.ts. Larger batches
  // and a higher limit than error reports, because a session emits dozens.
  // user_id is the token's, never the body's: a forged event can claim to be
  // any device but not any account.
  router.post(
    '/analytics',
    rateLimit({ scope: 'client:analytics', limit: 120, windowMs: 60_000, by: 'ip+user' }),
    validate(analyticsBody),
    async (req, res, next) => {
      try {
        const { app, deviceId, events } = req.body as z.infer<typeof analyticsBody>;
        const accepted = await recordAnalytics({
          userId: req.userId ?? null,
          deviceId: deviceId ?? null,
          app: { version: app.version, platform: app.platform, update: app.update },
          events,
        });
        res.status(202).json({ accepted });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
