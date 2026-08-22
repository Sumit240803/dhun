import { NextFunction, Request, Response } from 'express';
import { AppError } from '../infra/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      idempotencyKey?: string;
    }
  }
}

/**
 * Day-1 non-negotiable #2: every endpoint that moves money carries an
 * `Idempotency-Key` header.
 *
 * Required, not optional. A missing key means the client cannot safely retry,
 * and a payment endpoint that cannot be retried will eventually double-charge
 * someone over a dropped connection.
 *
 * The key must be a UUID. React Native's `uuid` package falls back to weak
 * randomness without `react-native-get-random-values`, and has been known to
 * emit duplicates — so the format check here is worth the two lines.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireIdempotencyKey() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.header('Idempotency-Key')?.trim();

    if (!key) {
      return next(
        new AppError(
          'IDEMPOTENCY_KEY_REQUIRED',
          'This endpoint moves money and requires an Idempotency-Key header',
          400,
        ),
      );
    }
    if (!UUID.test(key)) {
      return next(
        new AppError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be a UUID', 400, { key }),
      );
    }

    req.idempotencyKey = key;
    next();
  };
}
