// Token issue, verification and rotation.
//
// Access token: short-lived JWT, stateless, checked on every request.
// Refresh token: long-lived opaque random value, stored HASHED, single-use.
//
// Refresh tokens rotate. Presenting one that has already been rotated means it
// leaked — a stolen token and the real client will both eventually try to use
// the same value — so the entire chain for that device is revoked rather than
// just rejecting the request.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PoolClient } from 'pg';
import { SignJWT, jwtVerify } from 'jose';
import { uuidv7 } from 'uuidv7';
import { config } from '../../config/index.js';
import { withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';

const secret = new TextEncoder().encode(config.auth.jwtSecret);
const ISSUER = 'dhun';

export interface AccessClaims {
  sub: string;
  status: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * HMAC rather than a bare hash. OTP codes are only six digits — about a million
 * possibilities — so a plain SHA-256 of the code would be trivially reversible
 * by anyone who could read the table. The server secret closes that.
 */
export function hmac(value: string): string {
  return createHmac('sha256', config.auth.jwtSecret).update(value).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function signAccessToken(userId: string, status: string): Promise<string> {
  return new SignJWT({ status })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setJti(uuidv7())
    .setExpirationTime(`${config.auth.accessTokenTtlMinutes}m`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    if (!payload.sub) throw new Error('missing sub');
    return { sub: payload.sub, status: String(payload.status ?? 'guest') };
  } catch {
    throw new AppError('INVALID_TOKEN', 'Access token is invalid or expired', 401);
  }
}

async function createRefreshToken(
  client: PoolClient,
  userId: string,
  deviceId: string | null,
  replacesId?: string,
): Promise<string> {
  // 256 bits of entropy: unguessable, so the stored HMAC needs no salt.
  const raw = randomBytes(32).toString('base64url');
  const id = uuidv7();
  const expiresAt = new Date(Date.now() + config.auth.refreshTokenTtlDays * 86_400_000);

  await client.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, expires_at)' +
      ' VALUES ($1,$2,$3,$4,$5)',
    [id, userId, hmac(raw), deviceId, expiresAt],
  );

  if (replacesId) {
    await client.query(
      'UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1',
      [replacesId, id],
    );
  }

  return raw;
}

export async function issueTokenPair(
  client: PoolClient,
  userId: string,
  status: string,
  deviceId: string | null,
): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(userId, status),
    createRefreshToken(client, userId, deviceId),
  ]);
  return { accessToken, refreshToken, expiresIn: config.auth.accessTokenTtlMinutes * 60 };
}

interface StoredToken {
  id: string;
  user_id: string;
  device_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  status: string;
}

type RotateOutcome =
  | { kind: 'ok'; tokens: TokenPair }
  | { kind: 'unknown' }
  | { kind: 'revoked' }
  | { kind: 'expired' }
  | { kind: 'replayed' }
  | { kind: 'banned' };

/**
 * Exchanges a refresh token for a new pair.
 *
 * Like verifyOtp, the outcome is returned and the error thrown AFTER the
 * transaction commits. On a replay we revoke the entire device chain — if that
 * revocation were undone by the throw, an attacker holding a stolen token would
 * keep a working session and the defence would be theatre.
 */
export async function rotateRefreshToken(presented: string): Promise<TokenPair> {
  const outcome = await withTransaction<RotateOutcome>(async (client) => {
    const { rows } = await client.query<StoredToken>(
      'SELECT t.id, t.user_id, t.device_id, t.expires_at, t.revoked_at, t.replaced_by, u.status' +
        ' FROM refresh_tokens t JOIN users u ON u.id = t.user_id' +
        ' WHERE t.token_hash = $1 FOR UPDATE OF t',
      [hmac(presented)],
    );
    const token = rows[0];

    if (!token) return { kind: 'unknown' };

    // Already rotated once, so two parties hold the same value. Treat it as
    // theft and cut the whole device chain rather than just declining.
    if (token.replaced_by) {
      logger.warn('refresh token replay detected — revoking chain', {
        user_id: token.user_id,
        device_id: token.device_id,
      });
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = now()' +
          ' WHERE user_id = $1 AND device_id IS NOT DISTINCT FROM $2 AND revoked_at IS NULL',
        [token.user_id, token.device_id],
      );
      return { kind: 'replayed' };
    }

    if (token.revoked_at) return { kind: 'revoked' };
    if (token.expires_at.getTime() < Date.now()) return { kind: 'expired' };

    // A banned account may not extend its session. Without this the ban only
    // bit at sign-in: the holder refreshed every fifteen minutes forever and
    // was never signed out.
    //
    // Their whole chain is revoked here rather than merely declining, so the
    // stored tokens cannot be tried again from another device.
    if (token.status === 'banned' || token.status === 'suspended') {
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [token.user_id],
      );
      return { kind: 'banned' };
    }

    const accessToken = await signAccessToken(token.user_id, token.status);
    const refreshToken = await createRefreshToken(client, token.user_id, token.device_id, token.id);

    return {
      kind: 'ok',
      tokens: { accessToken, refreshToken, expiresIn: config.auth.accessTokenTtlMinutes * 60 },
    };
  });

  switch (outcome.kind) {
    case 'ok':
      return outcome.tokens;
    case 'replayed':
      throw new AppError('REFRESH_TOKEN_REUSED', 'Session ended for security reasons', 401);
    case 'banned':
      throw new AppError('ACCOUNT_BANNED', 'This account has been banned', 403);
    case 'expired':
      throw new AppError('REFRESH_TOKEN_EXPIRED', 'Refresh token has expired', 401);
    case 'revoked':
      throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token has been revoked', 401);
    case 'unknown':
      throw new AppError('INVALID_REFRESH_TOKEN', 'Refresh token is not valid', 401);
  }
}

/** Logout. Ends one device's session, or every session for the user. */
export async function revokeRefreshTokens(userId: string, deviceId?: string): Promise<number> {
  return withTransaction(async (client) => {
    const { rowCount } = deviceId
      ? await client.query(
          'UPDATE refresh_tokens SET revoked_at = now()' +
            ' WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL',
          [userId, deviceId],
        )
      : await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [userId],
        );
    return rowCount ?? 0;
  });
}
