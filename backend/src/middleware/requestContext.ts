import { NextFunction, Request, Response } from 'express';
import { uuidv7 } from 'uuidv7';
import { runWithContext } from '../infra/context.js';
import { logger } from '../infra/logger.js';

/**
 * Opens the async context for a request and logs its completion.
 *
 * The trace id comes from the client when it sends one (the app generates it
 * per user action, so a single tap is traceable across retries), otherwise we
 * mint it here. It goes back on the response so support can read it off a
 * screenshot.
 */
export function requestContext() {
  return (req: Request, res: Response, next: NextFunction) => {
    const traceId = (req.header('X-Trace-Id') || '').trim() || uuidv7();
    res.setHeader('X-Trace-Id', traceId);

    runWithContext({ traceId, path: `${req.method} ${req.path}` }, () => {
      const startedAt = process.hrtime.bigint();

      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const meta = { status: res.statusCode, duration_ms: Math.round(ms * 100) / 100 };
        if (res.statusCode >= 500) logger.error('request failed', undefined, meta);
        else logger.info('request', meta);
      });

      next();
    });
  };
}
