// Builds the HTTP app and mounts each module under /v1/<module>.
// One deployable app — the modules are internal boundaries, not separate servers.
import express from 'express';
import { config } from './config/index.js';
import { pool } from './infra/db.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalRateLimit } from './middleware/rateLimit.js';
import { requestContext } from './middleware/requestContext.js';
import { cors, requireJsonBody, securityHeaders } from './middleware/security.js';
import { buildAuthRouter } from './modules/auth/index.js';
import { buildCatalogRouter, buildWalletRouter } from './modules/economy/index.js';

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

  // Mounted as each milestone lands (see docs/build-plan.md):
  //   app.use('/v1/rooms', roomsRouter);      // M5
  //   app.use('/v1/gifts', giftsRouter);      // M6

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
}
