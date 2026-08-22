import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { traceId } from '../infra/context.js';
import {
  AppError,
  BadJsonError,
  GENERIC_ERROR_MESSAGE,
  PayloadTooLargeError,
  ValidationError,
  mapDatabaseError,
} from '../infra/errors.js';
import { logger } from '../infra/logger.js';
import { toFieldIssues } from './validate.js';

/** body-parser tags its failures; each maps to a deliberate status. */
interface BodyParserError {
  type?: string;
  status?: number;
}

/**
 * Normalises anything thrown anywhere into an AppError.
 *
 * The default branch is the important one: an error we did not anticipate must
 * still leave the process as a clean 500 with an opaque message. A raw error
 * reaching the client leaks stack traces, file paths and SQL.
 */
function normalise(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) return new ValidationError(toFieldIssues(err));

  const bp = err as BodyParserError;
  if (bp?.type === 'entity.parse.failed') return new BadJsonError();
  if (bp?.type === 'entity.too.large') return new PayloadTooLargeError();
  if (bp?.type === 'encoding.unsupported') {
    return new AppError('UNSUPPORTED_ENCODING', 'Request encoding is not supported', 415);
  }

  const dbError = mapDatabaseError(err);
  if (dbError) return dbError;

  // Client hung up mid-request. Nothing to report and nobody to report it to.
  if ((err as { code?: string })?.code === 'ECONNRESET') {
    return new AppError('CLIENT_DISCONNECTED', 'Client disconnected', 499);
  }

  // Keep the original message for the logs; `expose` is false at 500, so the
  // client receives the generic substitute instead.
  const message = err instanceof Error ? err.message : String(err);
  return new AppError('INTERNAL_ERROR', message, 500);
}

/**
 * The single error envelope:
 *
 *   { "error": { "code", "message", "details"?, "trace_id" } }
 *
 * `code` is stable and is what clients switch on — never the HTTP status, never
 * the message, both of which we reserve the right to reword.
 */
export function errorHandler() {
  return (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);

    const appError = normalise(err);

    // 5xx is our fault and gets the original error with its stack. 4xx is the
    // caller being told something actionable, so it logs at warn without noise.
    if (appError.status >= 500) {
      logger.error(appError.code, err, appError.internal);
    } else {
      logger.warn(appError.code, {
        status: appError.status,
        ...(appError.internal ?? {}),
      });
    }

    if (appError.status === 499) return res.end();

    res.status(appError.status).json({
      error: {
        code: appError.code,
        // Anything not explicitly marked safe is replaced. This is the single
        // place that decides what a client is allowed to read.
        message: appError.expose ? appError.message : GENERIC_ERROR_MESSAGE,
        // `details` is curated per error type; `internal` never crosses this line.
        ...(appError.details && Object.keys(appError.details).length
          ? { details: appError.details }
          : {}),
        trace_id: traceId(),
      },
    });
  };
}

export function notFoundHandler() {
  return (req: Request, res: Response) =>
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        // The method and path came from the caller, so echoing them back is safe
        // and saves a support round trip. Nothing else is revealed.
        message: `No route for ${req.method} ${req.path}`,
        trace_id: traceId(),
      },
    });
}
