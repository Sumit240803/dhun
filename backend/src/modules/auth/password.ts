// Password hashing.
//
// scrypt, from node:crypto. Chosen over bcrypt and argon2 for one practical
// reason: both of those are native addons that have to compile on every machine
// and in every CI image, and a password hash that fails to build is an outage.
// scrypt is memory-hard, in the standard library, and is on OWASP's list of
// acceptable choices when argon2id is not available.
//
// If argon2id becomes worth the native dependency later, the stored format
// below carries its own algorithm name, so both can coexist and old hashes can
// be upgraded on next successful login rather than in a migration.

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'crypto';
import { promisify } from 'util';

// promisify loses the options overload, so the signature is restated. Without
// this the cost parameters below would be silently dropped and every hash would
// use Node's defaults — which are far weaker than what this file claims.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * OWASP's floor for scrypt is N=2^17, r=8, p=1. That costs roughly 128MB and
 * ~100ms per hash, which is the point: it has to be slow enough to make a
 * stolen hash table expensive and fast enough that a login does not time out.
 */
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * Bounded on purpose.
 *
 * A 10MB password would spend ten megabytes of memory bandwidth per attempt
 * before the hash even starts — an unauthenticated denial of service that costs
 * the attacker one request. 200 characters is far past any real passphrase.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

/** `scrypt$N$r$p$salt$hash`, all base64url. Self-describing, so parameters can change. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    // Node refuses scrypt above a default 32MB budget; N=2^17 needs more.
    maxmem: 256 * 1024 * 1024,
  });

  return ['scrypt', N, R, P, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

/**
 * Constant-time comparison against a stored hash.
 *
 * Returns false rather than throwing on a malformed record: a corrupted row
 * should fail the login, not crash the endpoint for everyone behind it.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;

    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');

    const derived = await scryptAsync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });

    // timingSafeEqual throws on a length mismatch, which would itself be a
    // timing signal. Checked first.
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * The rules, deliberately short.
 *
 * Length only. Complexity requirements — one capital, one symbol — are known to
 * produce WORSE passwords: people satisfy them with Password1! and reuse it
 * everywhere. Length is the property that actually resists a guess.
 */
export function passwordProblem(password: string): 'too_short' | 'too_long' | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (password.length > MAX_PASSWORD_LENGTH) return 'too_long';
  return null;
}
