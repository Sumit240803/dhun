// POST /v1/webhooks/livekit
//
// Mounted BEFORE the JSON body parser in app.ts, and that is not a style
// choice. Two reasons, either of which breaks this route on its own:
//
//   1. The signature is over the RAW BYTES. Once express.json() has parsed and
//      re-serialised the body, key order and whitespace have moved and the
//      signature can never verify again.
//   2. LiveKit sends `Content-Type: application/webhook+json`, which
//      requireJsonBody() rejects with a 415 before any handler runs.
//
// ── The header trap ──────────────────────────────────────────────────────────
//
// LiveKit's docs say the signature is in `Authorization`. The SDK exports
// `authorizeHeader = "Authorize"`. They disagree, and picking the wrong one
// rejects every webhook with a 401 that looks exactly like a misconfigured
// secret — so both are read, in the order the docs claim.

import { Router, raw } from 'express';
import { config } from '../../config/index.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { webhookReceiver } from './livekit.provider.js';
import { applyWebhookEvent } from './webhooks.service.js';

/** Generous next to a body of a few hundred bytes, and still a hard ceiling. */
const MAX_WEBHOOK_BYTES = 64 * 1024;

export function buildWebhooksRouter(): Router {
  const router = Router();

  router.post(
    '/livekit',
    // `type: '*/*'` because the content type is application/webhook+json and
    // there is no value in refusing a correctly SIGNED body over its label.
    // The signature is the real gate; the header is decoration.
    raw({ type: '*/*', limit: MAX_WEBHOOK_BYTES }),
    async (req, res, next) => {
      try {
        // An unconfigured deploy has no secret to verify against. 503, not 401:
        // nothing is wrong with the request and the sender should try later.
        if (!config.livekit.configured) {
          throw new AppError('RTC_UNAVAILABLE', 'Webhooks are not configured', 503);
        }

        const signature = req.get('Authorization') ?? req.get('Authorize');
        if (!signature) {
          throw new AppError('WEBHOOK_UNSIGNED', 'Missing signature', 401);
        }

        const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

        let event;
        try {
          event = await webhookReceiver().receive(body, signature);
        } catch (err) {
          // Deliberately loud. The only two ways here are a wrong shared secret
          // and someone forging events — and the second is how an attacker
          // would end a room or fake host hours.
          logger.warn('livekit webhook rejected', { err });
          throw new AppError('WEBHOOK_INVALID', 'Signature could not be verified', 401);
        }

        await applyWebhookEvent(event);

        // 200 with no body. LiveKit retries on a non-2xx, which is what we want
        // for a transient database failure — that error propagates to the
        // handler below and becomes a 500, and the event arrives again.
        res.status(200).end();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
