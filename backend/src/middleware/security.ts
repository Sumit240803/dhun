// Security headers, CORS, and content-type enforcement.
//
// Hand-rolled rather than pulled from a package: this is a JSON API, the useful
// header set is small, and every one below is here for a stated reason.

import { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';
import { UnsupportedMediaTypeError } from '../infra/errors.js';

export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction) => {
    // Never let a browser sniff a JSON response into something executable.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // No page of ours belongs in a frame — clickjacking has no upside here.
    res.setHeader('X-Frame-Options', 'DENY');
    // Do not leak our URLs (which contain ids) to third-party sites.
    res.setHeader('Referrer-Policy', 'no-referrer');
    // An API needs none of these; denying them shrinks the blast radius if a
    // response is ever rendered in a browser context.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    // Nothing here should ever be cached by an intermediary — responses carry
    // balances and tokens.
    res.setHeader('Cache-Control', 'no-store');
    // Belt and braces: an API response should never execute anything.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

    // HSTS only in production: on localhost it would pin the browser to https
    // for the whole origin and make development miserable.
    if (config.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    next();
  };
}

/**
 * CORS with an explicit allowlist.
 *
 * Native apps do not send Origin, so this exists for the web recharge portal and
 * the admin panel. There is no wildcard: the API is credentialed, and `*` with
 * credentials is both forbidden by the spec and a genuine hole.
 */
export function cors() {
  const allowed = new Set(config.corsOrigins);

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header('Origin');

    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization,Idempotency-Key,X-Trace-Id,X-Device-Id',
      );
      res.setHeader(
        'Access-Control-Expose-Headers',
        'X-Trace-Id,RateLimit-Limit,RateLimit-Remaining,RateLimit-Reset,Retry-After',
      );
      res.setHeader('Access-Control-Max-Age', '600');
    }

    // Answer the preflight before anything else can reject it.
    if (req.method === 'OPTIONS') {
      res.status(origin && allowed.has(origin) ? 204 : 403).end();
      return;
    }

    next();
  };
}

/**
 * Requires JSON on requests that carry a body.
 *
 * Without this, a form-encoded POST arrives with an empty `req.body` and every
 * field reads as missing — which surfaces as a confusing validation error rather
 * than the real problem. It also blocks the simple-request CSRF shapes that
 * `application/x-www-form-urlencoded` and `text/plain` allow.
 */
export function requireJsonBody() {
  const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

  return (req: Request, _res: Response, next: NextFunction) => {
    if (!METHODS_WITH_BODY.has(req.method)) return next();

    const declared = req.header('Content-Length');
    const hasBody = declared !== undefined && declared !== '0';
    const chunked = req.header('Transfer-Encoding') !== undefined;
    if (!hasBody && !chunked) return next();

    const contentType = req.header('Content-Type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return next(new UnsupportedMediaTypeError());
    }

    next();
  };
}
