// Bootstraps infrastructure, wires event subscribers, starts the HTTP server.
//
// This is the API process. The realtime gateway (WebSocket) and the worker
// process are separate entry points sharing this codebase — see the three-process
// note in CLAUDE.md.
import { buildApp } from './app.js';
import { config } from './config/index.js';
import { pool } from './infra/db.js';
import { logger } from './infra/logger.js';
import { registerLeaderboardSubscribers } from './modules/leaderboard/index.js';

function registerSubscribers() {
  // Every module that REACTS to events wires its subscribers here at startup.
  registerLeaderboardSubscribers();
}

/**
 * Last-resort process handlers.
 *
 * An uncaught exception leaves the process in an unknown state — a transaction
 * may be half-applied, a lock still held. The only safe response is to log it and
 * exit so the orchestrator restarts clean; limping on is how corrupt money data
 * happens. An unhandled rejection is nearly always a missing `await`, so it is
 * loud but not fatal.
 */
function installProcessHandlers(shutdown: (signal: string, code?: number) => void) {
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception — shutting down', err);
    shutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', reason);
  });

  process.on('warning', (warning) => {
    logger.warn('node warning', { name: warning.name, message: warning.message });
  });
}

async function main() {
  registerSubscribers();

  // Fail fast: a process that cannot reach Postgres should never accept traffic.
  await pool.query('SELECT 1');

  const app = buildApp();
  const server = app.listen(config.port, () =>
    logger.info('api listening', { port: config.port, env: config.nodeEnv }),
  );

  // Caps a request that hangs on something we did not anticipate, so a stuck
  // handler cannot hold a socket open indefinitely.
  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.requestTimeoutMs + 5_000;
  // Above a typical load-balancer idle timeout, so the balancer closes idle
  // connections rather than us — which is what avoids sporadic 502s.
  server.keepAliveTimeout = 65_000;

  let shuttingDown = false;

  const shutdown = (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });

    // Drain in-flight requests first: a deploy must never sever a half-written
    // money transaction.
    server.close(async () => {
      try {
        await pool.end();
      } catch (err) {
        logger.error('error closing pool', err);
      }
      process.exit(exitCode);
    });

    // If draining stalls, leave anyway rather than hanging the deploy.
    setTimeout(() => {
      logger.error('forced exit — connections did not drain in time');
      process.exit(exitCode || 1);
    }, 15_000).unref();
  };

  installProcessHandlers(shutdown);
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('failed to start', err);
  process.exit(1);
});
