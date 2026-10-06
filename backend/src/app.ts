// Builds the HTTP app and mounts each module under /v1/<module>.
// One deployable app — the modules are internal boundaries, not separate servers.
import express from 'express';
import { config } from './config/index.js';
import { pool } from './infra/db.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalRateLimit } from './middleware/rateLimit.js';
import { requestContext } from './middleware/requestContext.js';
import { cors, requireJsonBody, securityHeaders } from './middleware/security.js';
import { buildAgencyAdminRouter, buildAgencyRouter } from './modules/agency/index.js';
import { buildAuthRouter } from './modules/auth/index.js';
import { buildMessagesRouter } from './modules/chat/index.js';
import { buildConfigRouter } from './modules/config/index.js';
import { buildCosmeticsRouter } from './modules/cosmetics/index.js';
import { buildDiscoverRouter } from './modules/discover/index.js';
import { buildCatalogRouter, buildWalletRouter } from './modules/economy/index.js';
import { buildGiftsRouter } from './modules/gifting/index.js';
import { buildMediaRouter } from './modules/media/index.js';
import { buildModerationRouter } from './modules/moderation/index.js';
import { buildNotificationsRouter } from './modules/notifications/index.js';
import { buildWebhooksRouter } from './modules/realtime/index.js';
import { buildRewardsRouter } from './modules/rewards/index.js';
import { buildRoomsRouter } from './modules/rooms/index.js';
import { buildUsersRouter } from './modules/users/index.js';

export function buildApp() {
  const app = express();

  // Order matters. Identity of the caller (trust proxy) has to be established
  // before anything rate-limits on it; headers and CORS answer before any body
  // is parsed; the body is parsed before anything validates it.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.disable('etag'); // responses carry balances; a 304 would be misleading

  app.use(requestContext());
  app.use(securityHeaders());
  app.use(cors());
  app.use(globalRateLimit());
  // BEFORE the JSON parser, and that ordering is load-bearing rather than
  // stylistic. LiveKit signs the RAW BYTES, so once express.json() has parsed
  // and re-serialised the body the signature can never verify again — and it
  // sends `Content-Type: application/webhook+json`, which requireJsonBody()
  // would reject with a 415 before any handler ran.
  //
  // Machine-to-machine and authenticated by signature, so it sits outside the
  // /v1 module mounts below.
  app.use('/v1/webhooks', buildWebhooksRouter());

  app.use(requireJsonBody());
  app.use(express.json({ limit: config.maxBodyBytes, strict: true }));

  // Liveness: is the process up? Used by the load balancer. Never touches the DB.
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Readiness: can it actually serve? A pod with a dead pool is pulled from
  // rotation instead of failing user requests.
  app.get('/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  // Day-1 non-negotiable #4: /v1/ from the first endpoint. Old app versions stay
  // alive forever, so the version prefix can never be retrofitted.
  app.use('/v1/auth', buildAuthRouter());
  app.use('/v1/catalog', buildCatalogRouter());
  app.use('/v1/wallet', buildWalletRouter());
  app.use('/v1/config', buildConfigRouter());
  app.use('/v1/rooms', buildRoomsRouter());
  app.use('/v1/messages', buildMessagesRouter());
  app.use('/v1/users', buildUsersRouter());
  app.use('/v1/moderation', buildModerationRouter());
  app.use('/v1/gifts', buildGiftsRouter());
  app.use('/v1/cosmetics', buildCosmeticsRouter());
  app.use('/v1/rewards', buildRewardsRouter());
  app.use('/v1/discover', buildDiscoverRouter());
  app.use('/v1/notifications', buildNotificationsRouter());
  app.use('/v1/agency', buildAgencyRouter());
  app.use('/v1/admin/agencies', buildAgencyAdminRouter());
  app.use('/v1/media', buildMediaRouter());

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}
