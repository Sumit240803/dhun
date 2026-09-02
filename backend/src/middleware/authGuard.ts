import { NextFunction, Request, Response } from 'express';
import { setContextUser } from '../infra/context.js';
import { AppError, ForbiddenError, UnauthenticatedError } from '../infra/errors.js';
import { pool } from '../infra/db.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { assertRole, ScopeType } from '../modules/auth/permissions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userStatus?: string;
    }
  }
}

function bearer(req: Request): string | undefined {
  const header = req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

/**
 * Requires a valid access token.
 *
 * Guests pass by default: a guest is a real, authenticated identity that simply
 * has no phone yet. Endpoints that need a registered user compose this with
 * requireRegistered().
 */
export function authGuard() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = bearer(req);
      if (!token) throw new UnauthenticatedError();

      const claims = await verifyAccessToken(token);
      assertUsable(claims.status);

      req.userId = claims.sub;
      req.userStatus = claims.status;
      setContextUser(claims.sub); // every later log line carries the user id
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Rejects an account that is no longer allowed to act.
 *
 * The status rides in the ACCESS TOKEN, so this costs no query — and the token
 * lives fifteen minutes, which bounds how long a ban takes to bite. The refresh
 * path refuses to mint a new one for a banned account, so the window cannot be
 * extended.
 *
 * Without this the ban was only checked at sign-in: a user banned mid-session
 * kept browsing, following, messaging and reporting indefinitely, because
 * nothing ever looked at the status again. Money endpoints were safe by
 * accident — `requireRegistered` demands 'active' — but nothing else was.
 */
function assertUsable(status: string): void {
  if (status === 'banned') {
    throw new AppError('ACCOUNT_BANNED', 'This account has been permanently banned', 403);
  }
  if (status === 'suspended') {
    throw new AppError('ACCOUNT_SUSPENDED', 'This account is temporarily suspended', 403);
  }
}

/** Reads the token when present but never rejects. For endpoints that behave differently when signed in. */
export function optionalAuth() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) return next();
    try {
      const claims = await verifyAccessToken(token);
      assertUsable(claims.status);

      req.userId = claims.sub;
      req.userStatus = claims.status;
      setContextUser(claims.sub);
    } catch {
      // An invalid token on an optional route is treated as no token at all.
      // A BANNED one lands here too, which is the right outcome: they see the
      // app exactly as a signed-out stranger does.
    }
    next();
  };
}

export function requireRegistered() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.userStatus !== 'active') {
      return next(
        new AppError('REGISTRATION_REQUIRED', 'Verify your phone number to continue', 403),
      );
    }
    next();
  };
}

/**
 * Hard rule #5: 18+ only.
 *
 * Enforced where it actually matters — anywhere money moves — rather than only
 * as an optional profile field. A user who has never supplied a date of birth is
 * refused, so the gate cannot be bypassed by simply skipping the question.
 *
 * The distinct DOB_REQUIRED code lets the app open the date picker instead of
 * showing a dead end.
 */
export function requireAdult() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.userId) throw new UnauthenticatedError();

      const { rows } = await pool.query<{ adult: boolean | null }>(
        "SELECT (date_of_birth <= (current_date - interval '18 years')) AS adult" +
          ' FROM user_profiles WHERE user_id = $1',
        [req.userId],
      );

      if (rows[0]?.adult === null || rows[0] === undefined) {
        throw new AppError('DOB_REQUIRED', 'Add your date of birth to continue', 403);
      }
      if (!rows[0].adult) {
        throw new ForbiddenError('You must be 18 or older to use this feature');
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Role check as middleware.
 *
 * `scopeFrom` pulls the scope id out of the request — usually a route param — so
 * "room admin of THIS room" is expressed without every handler rewriting it.
 */
export function requireRole(
  roleCode: string,
  scope?: { type: Exclude<ScopeType, 'global'>; scopeFrom: (req: Request) => string | undefined },
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.userId) throw new UnauthenticatedError();

      if (!scope) {
        await assertRole(req.userId, roleCode);
      } else {
        const scopeId = scope.scopeFrom(req);
        if (!scopeId) throw new AppError('BAD_REQUEST', 'Missing scope identifier', 400);
        await assertRole(req.userId, roleCode, { type: scope.type, id: scopeId });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
