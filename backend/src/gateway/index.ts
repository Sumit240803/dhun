// The realtime gateway process.
//
//   npm run gateway
//
// Third of the three processes, alongside the API and the workers. Separate
// because it scales on CONCURRENCY rather than request rate — ten thousand
// idle sockets are nothing to a CPU and everything to a connection table — and
// because a gateway restart must not interrupt the API that takes money.
//
// Deployment note for later: this is the one process that cannot be rolled
// without dropping connections. Clients reconnect, which is why the client
// hook has backoff, but a deploy during peak hours is felt.

import { config } from '../config/index.js';
import { logger } from '../infra/logger.js';
import { pool } from '../infra/db.js';
import { buildGateway, shutdownGateway } from './server.js';

const PORT = Number(process.env.GATEWAY_PORT ?? 3001);

async function main(): Promise<void> {
  const { server, wss } = buildGateway();

  server.listen(PORT, () => {
    logger.info('gateway listening', { port: PORT, env: config.nodeEnv });
  });

  const stop = (signal: string) => {
    void (async () => {
      logger.info('gateway shutting down', { signal });
      await shutdownGateway(wss);
      server.close();
      await pool.end();
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  // A gateway that dies silently takes every live room with it and nothing
  // says so. Same treatment as the API: log loudly, then exit so the
  // supervisor restarts a clean process rather than continuing in an unknown
  // state.
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception — shutting down', { err });
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    logger.error('unhandled rejection — shutting down', { err });
    process.exit(1);
  });
}

void main();
