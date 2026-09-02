import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { config } from '../../config/index.js';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { emailProvider, type EmailPurpose } from './email.provider.js';
import { hashPassword, passwordProblem, verifyPassword } from './password.js';
import { issueTokenPair } from './tokens.js';
import type { DeviceInfo, SessionUser } from './auth.service.js';

const CODE_LENGTH = 6;

/**
 * HMAC, not a bare hash.
 *
 * A six-digit code has a million possibilities — a rainbow table of every SHA
 * of every code fits in a text file. Keying the digest with the server secret
 * means a stolen database yields nothing without the secret too.
 */
function hmac(value: string): string {
  return createHmac('sha256', config.auth.jwtSecret).update(value).digest('hex');
}

/** Cryptographically random, not Math.random. A guessable reset code is an account takeover. */
function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/** Compared case-insensitively everywhere; stored as typed for display. */
function normalise(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Mints and sends a code.
 *
 * Any live code for the same user and purpose is consumed first, so a resend
 * invalidates the previous one. Without that, five resends leave five working
 * codes and the attempt limit means five times less than it looks.
 */
async function issueCode(
  client: PoolClient,
  input: { userId: string; email: string; purpose: EmailPurpose },
): Promise<string> {
  const recent = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM email_verifications
      WHERE email = $1 AND created_at > now() - interval '1 hour'`,
    [normalise(input.email)],
  );

  if (Number(recent.rows[0]?.n ?? 0) >= config.email.codesPerHour) {
    throw new AppError('EMAIL_RATE_LIMITED', 'Too many emails requested. Try again later.', 429);
  }

  await client.query(
    `UPDATE email_verifications SET consumed_at = now()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [input.userId, input.purpose],
  );

  const code = generateCode();

  await client.query(
    `INSERT INTO email_verifications (id, user_id, email, purpose, code_hash, expires_at)
          VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)`,
    [uuidv7(), input.userId, normalise(input.email), input.purpose, hmac(code), String(config.email.codeTtlMinutes)],
  );

  return code;
}

/**
 * Registers with an email address.
 *
 * The account is usable IMMEDIATELY. Verification is a separate step that can
 * happen whenever — blocking the app behind an inbox round trip is where signup
 * funnels die, and what verification actually gates is money, not access.
 *
 * A guest calling this is UPGRADED in place, exactly like phone signup, so
 * nothing earned before signing up is orphaned.
 */
export async function registerWithEmail(input: {
  email: string;
  password: string;
  device: DeviceInfo;
  guestUserId?: string;
}): Promise<{ user: SessionUser; isNewUser: boolean } & Awaited<ReturnType<typeof issueTokenPair>>> {
  const problem = passwordProblem(input.password);
  if (problem !== null) {
    throw new AppError(
      problem === 'too_short' ? 'PASSWORD_TOO_SHORT' : 'PASSWORD_TOO_LONG',
      problem === 'too_short'
        ? 'Use at least 8 characters'
        : 'That password is too long',
      422,
    );
  }

  const email = normalise(input.email);
  const passwordHash = await hashPassword(input.password);

  const { userId, code } = await withTransaction(async (client) => {
    const taken = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (taken.rowCount! > 0) {
      // Explicit, unlike the login path. Registration cannot hide a duplicate
      // without silently doing nothing, and an account the user believes exists
      // but cannot reach is worse than knowing the address is taken.
      throw new AppError('EMAIL_TAKEN', 'An account already uses this email', 409);
    }

    let userId: string;

    if (input.guestUserId) {
      const upgraded = await client.query(
        `UPDATE users SET email = $2, password_hash = $3, status = 'active'
          WHERE id = $1 AND status = 'guest' RETURNING id`,
        [input.guestUserId, input.email.trim(), passwordHash],
      );
      // The guest may have been upgraded by another device in the meantime.
      // Falling through to a fresh account is wrong; refusing is honest.
      if (upgraded.rowCount === 0) {
        throw new AppError('SESSION_STALE', 'Sign in again to continue', 409);
      }
      userId = input.guestUserId;
    } else {
      userId = uuidv7();
      await client.query(
        `INSERT INTO users (id, status, email, password_hash) VALUES ($1,'active',$2,$3)`,
        [userId, input.email.trim(), passwordHash],
      );
      await client.query('INSERT INTO user_profiles (user_id) VALUES ($1)', [userId]);
    }

    const code = await issueCode(client, { userId, email, purpose: 'verify' });
    return { userId, code };
  });

  await emailProvider().sendCode(email, code, 'verify');

  const tokens = await withTransaction((client) =>
    issueTokenPair(client, userId, 'active', input.device.deviceId),
  );

  return {
    user: {
      id: userId,
      status: 'active',
      phone: null,
      email: input.email.trim(),
      emailVerified: false,
      displayName: null,
      profileComplete: false,
      roles: [],
    },
    isNewUser: true,
    ...tokens,
  };
}

/**
 * Signs in with an email and password.
 *
 * ONE error for every failure — unknown address, wrong password, an account
 * with no password set. Distinguishing them turns the login form into an
 * account-existence oracle, which on an app of this kind can out someone.
 *
 * A dummy verification runs when the account does not exist, so the response
 * takes the same ~100ms either way. Without it the timing leaks exactly what
 * the shared message is hiding.
 */
export async function loginWithEmail(input: {
  email: string;
  password: string;
  device: DeviceInfo;
}): Promise<{ user: SessionUser } & Awaited<ReturnType<typeof issueTokenPair>>> {
  const email = normalise(input.email);

  const { rows } = await pool.query<{
    id: string;
    status: string;
    email: string;
    email_verified_at: Date | null;
    password_hash: string | null;
    display_name: string | null;
    date_of_birth: Date | null;
  }>(
    `SELECT u.id, u.status, u.email, u.email_verified_at, u.password_hash,
            p.display_name, p.date_of_birth
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE lower(u.email) = $1`,
    [email],
  );

  const row = rows[0];

  if (!row?.password_hash) {
    // Same cost as a real check, so the absence of an account is not timeable.
    await verifyPassword(input.password, DUMMY_HASH);
    throw invalidCredentials();
  }

  const ok = await verifyPassword(input.password, row.password_hash);
  if (!ok) throw invalidCredentials();

  if (row.status === 'banned') {
    throw new AppError('ACCOUNT_BANNED', 'This account has been banned', 403);
  }
  if (row.status === 'suspended') {
    throw new AppError('ACCOUNT_SUSPENDED', 'This account is temporarily suspended', 403);
  }

  const tokens = await withTransaction((client) =>
    issueTokenPair(client, row.id, row.status, input.device.deviceId),
  );

  return {
    user: {
      id: row.id,
      status: row.status,
      phone: null,
      email: row.email,
      emailVerified: row.email_verified_at !== null,
      displayName: row.display_name,
      profileComplete: row.display_name !== null && row.date_of_birth !== null,
      roles: [],
    },
    ...tokens,
  };
}

function invalidCredentials(): AppError {
  return new AppError('INVALID_CREDENTIALS', 'That email or password is not correct', 401);
}

/**
 * A real scrypt hash of a value nobody knows, used only to burn the same time
 * as a genuine check. Generated once at module load rather than per request.
 */
const DUMMY_HASH =
  'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Sends (or resends) the confirmation code for the signed-in user's address. */
export async function requestEmailVerification(userId: string): Promise<void> {
  const { email, code } = await withTransaction(async (client) => {
    const { rows } = await client.query<{ email: string | null; verified: Date | null }>(
      'SELECT email, email_verified_at AS verified FROM users WHERE id = $1',
      [userId],
    );

    const row = rows[0];
    if (!row?.email) {
      throw new AppError('NO_EMAIL', 'Add an email address first', 422);
    }
    if (row.verified !== null) {
      throw new AppError('EMAIL_ALREADY_VERIFIED', 'This email is already confirmed', 409);
    }

    const code = await issueCode(client, { userId, email: row.email, purpose: 'verify' });
    return { email: row.email, code };
  });

  await emailProvider().sendCode(normalise(email), code, 'verify');
}

/**
 * Confirms an address.
 *
 * The attempt counter is incremented and COMMITTED before any rejection is
 * thrown — the same trap the OTP flow hit, where the throw rolled back the
 * increment and made brute-force protection theatre.
 */
export async function confirmEmail(userId: string, code: string): Promise<{ verified: true }> {
  type Outcome = { kind: 'ok' } | { kind: 'none' } | { kind: 'exhausted' } | { kind: 'wrong' };

  const outcome = await withTransaction<Outcome>(async (client) => {
    const { rows } = await client.query<{
      id: string;
      email: string;
      code_hash: string;
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT id, email, code_hash, attempts, max_attempts
         FROM email_verifications
        WHERE user_id = $1 AND purpose = 'verify'
          AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [userId],
    );

    const challenge = rows[0];
    if (!challenge) return { kind: 'none' };
    if (challenge.attempts >= challenge.max_attempts) return { kind: 'exhausted' };

    const presented = Buffer.from(hmac(code));
    const expected = Buffer.from(challenge.code_hash);
    const matches = presented.length === expected.length && timingSafeEqual(presented, expected);

    if (!matches) {
      await client.query('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1', [
        challenge.id,
      ]);
      return { kind: 'wrong' };
    }

    await client.query('UPDATE email_verifications SET consumed_at = now() WHERE id = $1', [
      challenge.id,
    ]);

    // Matched against the SNAPSHOTTED address, so a code sent to an old
    // address cannot confirm one the user changed to afterwards.
    await client.query(
      'UPDATE users SET email_verified_at = now() WHERE id = $1 AND lower(email) = $2',
      [userId, challenge.email],
    );

    logger.info('email verified', { user_id: userId });
    return { kind: 'ok' };
  });

  switch (outcome.kind) {
    case 'ok':
      return { verified: true };
    case 'none':
      throw new AppError('CODE_NOT_FOUND', 'No active code. Request a new one.', 400);
    case 'exhausted':
      throw new AppError('CODE_ATTEMPTS_EXCEEDED', 'Too many wrong attempts. Request a new code.', 429);
    default:
      throw new AppError('CODE_INVALID', 'That code is not correct', 401);
  }
}
