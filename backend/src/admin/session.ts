// Who is signed into the admin panel.
//
// ── A cookie, not a bearer token ────────────────────────────────────────────
//
// The app uses `Authorization: Bearer` because it is a native client holding
// its own tokens. A browser cannot do that for server-rendered pages — there
// is no JavaScript to attach a header to a link — so the panel uses a signed
// cookie instead.
//
// It is a separate credential from the app's access token on purpose. An admin
// cookie leaking must not be usable against the app's API, and an app token
// must never open the panel.
//
// ── CSRF ────────────────────────────────────────────────────────────────────
//
// `SameSite=Strict` stops a cross-site POST in every browser that matters, and
// a token in every form is checked on top of it. Belt and braces, because the
// POSTs here suspend accounts and close other people's broadcasts, and the
// cost of the second measure is one hidden input.

import { randomBytes, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config/index.js';
import { pool } from '../infra/db.js';
import { logger } from '../infra/logger.js';

const COOKIE = 'dhun_admin';
const ISSUER = 'dhun-admin';
/**
 * Short. A back-office session left open on a shared machine is the realistic
 * threat here, not somebody cracking the signature.
 */
const TTL_HOURS = 8;

const secret = new TextEncoder().encode(config.auth.jwtSecret);

/** The roles that may open the panel at all. */
export const STAFF_ROLES = ['super_admin', 'ops_manager', 'content_moderator', 'ts_lead'];

export interface StaffSession {
  userId: string;
  name: string;
  roles: string[];
  csrf: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    staff?: StaffSession;
  }
}

export async function issueSession(
  res: Response,
  staff: { userId: string; name: string; roles: string[] },
): Promise<void> {
  const csrf = randomBytes(24).toString('base64url');

  const token = await new SignJWT({ name: staff.name, roles: staff.roles, csrf })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(staff.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${TTL_HOURS}h`)
    .sign(secret);

  res.cookie(COOKIE, token, {
    httpOnly: true,
    // Over TLS only in production. Not in development, or the cookie is never
    // stored and nobody can sign in locally.
    secure: config.isProduction,
    sameSite: 'strict',
    // Scoped to the panel, so it is never sent to the /v1 API.
    path: '/admin',
    maxAge: TTL_HOURS * 3_600_000,
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE, { path: '/admin' });
}

/**
 * Reads the Cookie header directly.
 *
 * `cookie-parser` would do it, and it is one more dependency for one header on
 * four routes. Splitting on `;` and taking the first `=` is the whole format.
 */
function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Loads the session if there is one. Does not require it.
 *
 * Roles are re-read from the database rather than trusted from the cookie — a
 * moderator whose access was revoked an hour ago must not keep it until their
 * cookie expires. The cookie proves WHO; the database decides WHAT.
 */
export async function loadSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = cookieValue(req, COOKIE);
  if (!token) return next();

  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    if (!payload.sub) return next();

    const roles = await currentStaffRoles(payload.sub);
    if (roles.length === 0) return next();

    req.staff = {
      userId: payload.sub,
      name: String(payload.name ?? 'Staff'),
      roles,
      csrf: String(payload.csrf ?? ''),
    };
  } catch {
    // Expired or tampered. Treated as signed out, which it is.
  }
  next();
}

/** Staff roles this user holds RIGHT NOW, not when they signed in. */
export async function currentStaffRoles(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ role_code: string }>(
    `SELECT role_code FROM role_assignments
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND scope_type = 'global'
        AND role_code = ANY($2::text[])`,
    [userId, STAFF_ROLES],
  );
  return rows.map((row) => row.role_code);
}

/** Sends anybody without a session to the sign-in page. */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.staff) return next();
  res.redirect('/admin/login');
}

/**
 * Rejects a POST whose CSRF token does not match the session's.
 *
 * Compared in constant time — not because a timing attack on a CSRF token is
 * likely, but because `===` on a secret is the habit worth not having.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const sent = String((req.body as { csrf?: unknown })?.csrf ?? '');
  const expected = req.staff?.csrf ?? '';

  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    logger.warn('admin csrf rejected', { user_id: req.staff?.userId, path: req.path });
    res.status(403).send('Request rejected. Reload the page and try again.');
    return;
  }
  next();
}

/** Narrower than a session: only these roles may do this. */
export function requireRoles(...allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.staff?.roles.some((role) => allowed.includes(role))) return next();
    res.status(403).send('You do not have access to that.');
  };
}
