import { createHmac } from 'crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';
import { closePool } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'email-device-0001', platform: 'android' };
const PASSWORD = 'correct horse battery';

let counter = 0;
const nextEmail = () => `user${counter++}.${Date.now()}@example.com`;

async function register(email = nextEmail(), password = PASSWORD) {
  const res = await request(app)
    .post('/v1/auth/email/register')
    .send({ email, password, device: { ...DEVICE, deviceId: `ed-${email}` } })
    .expect(201);
  return { email, ...(res.body as { accessToken: string; user: { id: string } }) };
}

/** The live challenge row for a user. Only its HASH is stored, never the code. */
async function challengeFor(userId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM email_verifications
      WHERE user_id = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0]?.id ?? '';
}

/**
 * Replaces a challenge's hash with one for a code the test knows.
 *
 * The plaintext is unrecoverable by design — that is the point of storing an
 * HMAC — so the test writes a known value rather than trying to read one back.
 * Computed in Node because pgcrypto is not installed, and adding an extension
 * to production just to make a test easier is the wrong trade.
 */
async function setCode(challengeId: string, code: string): Promise<void> {
  const hash = createHmac('sha256', process.env.JWT_SECRET!).update(code).digest('hex');
  await pool.query('UPDATE email_verifications SET code_hash = $2 WHERE id = $1', [
    challengeId,
    hash,
  ]);
}

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(closePool);

describe('password hashing', () => {
  it('round-trips, and rejects a wrong password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces a different hash every time, so the salt is real', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('returns false on a malformed record instead of throwing', async () => {
    // A corrupted row should fail the login, not crash the endpoint for
    // everyone queued behind it.
    expect(await verifyPassword(PASSWORD, 'not-a-hash')).toBe(false);
    expect(await verifyPassword(PASSWORD, '')).toBe(false);
    expect(await verifyPassword(PASSWORD, 'bcrypt$x$y')).toBe(false);
  });
});

describe('registering with an email', () => {
  it('works immediately, with the address still unconfirmed', async () => {
    // Deferred verification is the point: blocking the app behind an inbox
    // round trip is where signup funnels die.
    const account = await register();

    const me = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    expect(me.body.user.email).toBeTruthy();
    expect(me.body.user.emailVerified).toBe(false);
    expect(me.body.user.status).toBe('active');
  });

  it('matches an existing address case-insensitively', async () => {
    const email = nextEmail();
    await register(email);

    const res = await request(app)
      .post('/v1/auth/email/register')
      .send({
        email: email.toUpperCase(),
        password: PASSWORD,
        device: { ...DEVICE, deviceId: 'duplicate-device' },
      })
      .expect(409);

    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('refuses a short password', async () => {
    const res = await request(app)
      .post('/v1/auth/email/register')
      .send({ email: nextEmail(), password: 'short', device: DEVICE })
      .expect(422);

    expect(res.body.error.code).toBe('PASSWORD_TOO_SHORT');
  });

  it('refuses an absurdly long password, which is a hashing DoS', async () => {
    await request(app)
      .post('/v1/auth/email/register')
      .send({ email: nextEmail(), password: 'x'.repeat(5000), device: DEVICE })
      .expect(422);
  });

  it('refuses a malformed address', async () => {
    await request(app)
      .post('/v1/auth/email/register')
      .send({ email: 'not-an-email', password: PASSWORD, device: DEVICE })
      .expect(422);
  });

  it('upgrades a guest in place, keeping their id', async () => {
    const guest = await request(app).post('/v1/auth/guest').send({ device: DEVICE }).expect(201);

    const upgraded = await request(app)
      .post('/v1/auth/email/register')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .send({ email: nextEmail(), password: PASSWORD, device: DEVICE })
      .expect(201);

    expect(upgraded.body.user.id).toBe(guest.body.user.id);
  });
});

describe('logging in with an email', () => {
  it('signs in with the right password', async () => {
    const account = await register();

    const res = await request(app)
      .post('/v1/auth/email/login')
      .send({ email: account.email, password: PASSWORD, device: DEVICE })
      .expect(200);

    expect(res.body.accessToken).toBeTruthy();
  });

  it('is case-insensitive on the address', async () => {
    const account = await register();

    await request(app)
      .post('/v1/auth/email/login')
      .send({ email: account.email.toUpperCase(), password: PASSWORD, device: DEVICE })
      .expect(200);
  });

  it('gives the SAME error for a wrong password and an unknown address', async () => {
    // Distinguishing them turns the login form into an account-existence
    // oracle, which on an app of this kind can out someone.
    const account = await register();

    const wrongPassword = await request(app)
      .post('/v1/auth/email/login')
      .send({ email: account.email, password: 'not the password', device: DEVICE })
      .expect(401);

    const unknownEmail = await request(app)
      .post('/v1/auth/email/login')
      .send({ email: nextEmail(), password: PASSWORD, device: DEVICE })
      .expect(401);

    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('refuses a phone-only account, which has no password', async () => {
    const guest = await request(app).post('/v1/auth/guest').send({ device: DEVICE }).expect(201);
    await pool.query("UPDATE users SET email = 'noPass@example.com' WHERE id = $1", [
      guest.body.user.id,
    ]);

    await request(app)
      .post('/v1/auth/email/login')
      .send({ email: 'nopass@example.com', password: PASSWORD, device: DEVICE })
      .expect(401);
  });

  it('refuses a banned account', async () => {
    const account = await register();
    await pool.query("UPDATE users SET status = 'banned' WHERE id = $1", [account.user.id]);

    const res = await request(app)
      .post('/v1/auth/email/login')
      .send({ email: account.email, password: PASSWORD, device: DEVICE })
      .expect(403);

    expect(res.body.error.code).toBe('ACCOUNT_BANNED');
  });
});

describe('confirming the address', () => {
  it('verifies with the right code, and reports it on /me', async () => {
    const account = await register();
    const challengeId = await challengeFor(account.user.id);

    const known = '123456';
    await setCode(challengeId, known);

    await request(app)
      .post('/v1/auth/email/verify')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ code: known })
      .expect(200);

    const me = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    expect(me.body.user.emailVerified).toBe(true);
  });

  it('counts a wrong attempt even though the request fails', async () => {
    // The trap the OTP flow hit: throwing rolled back the increment, so
    // brute-force protection did nothing at all.
    const account = await register();
    const challengeId = await challengeFor(account.user.id);

    await request(app)
      .post('/v1/auth/email/verify')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ code: '000000' })
      .expect(401);

    const { rows } = await pool.query<{ attempts: number }>(
      'SELECT attempts FROM email_verifications WHERE id = $1',
      [challengeId],
    );
    expect(rows[0].attempts).toBe(1);
  });

  it('rejects a code that is not six digits', async () => {
    const account = await register();

    await request(app)
      .post('/v1/auth/email/verify')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ code: 'abcdef' })
      .expect(422);
  });

  it('invalidates the previous code when a new one is sent', async () => {
    // Five resends leaving five working codes would make the attempt limit
    // mean five times less than it looks.
    const account = await register();
    const first = await challengeFor(account.user.id);

    await request(app)
      .post('/v1/auth/email/verify/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(202);

    const { rows } = await pool.query<{ consumed_at: Date | null }>(
      'SELECT consumed_at FROM email_verifications WHERE id = $1',
      [first],
    );
    expect(rows[0].consumed_at).not.toBeNull();
  });

  it('refuses to re-verify an already confirmed address', async () => {
    const account = await register();
    await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [account.user.id]);

    const res = await request(app)
      .post('/v1/auth/email/verify/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(409);

    expect(res.body.error.code).toBe('EMAIL_ALREADY_VERIFIED');
  });
});

describe('money needs a verified contact', () => {
  it('refuses an unverified email account, even though it is active', async () => {
    // Deferred verification gates MONEY, not access. This is where that rule
    // actually holds.
    const account = await register();
    await pool.query(
      `UPDATE user_profiles SET date_of_birth = date '1998-04-12' WHERE user_id = $1`,
      [account.user.id],
    );

    const res = await request(app)
      .post('/v1/wallet/convert')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', '11111111-1111-4111-8111-111111111111')
      .send({ coins: 100 })
      .expect(403);

    expect(res.body.error.code).toBe('CONTACT_UNVERIFIED');
  });

  it('allows it once the address is confirmed', async () => {
    const account = await register();
    await pool.query(
      `UPDATE user_profiles SET date_of_birth = date '1998-04-12' WHERE user_id = $1`,
      [account.user.id],
    );
    await pool.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [account.user.id]);

    // Passes the gate and fails on the balance instead, which is the next
    // check and proves the guard let it through.
    const res = await request(app)
      .post('/v1/wallet/convert')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .set('Idempotency-Key', '22222222-2222-4222-8222-222222222222')
      .send({ coins: 100 })
      // 402: it cleared the gate and failed on the balance instead, which is
      // the next check and is exactly what proves the guard let it through.
      .expect(402);

    expect(res.body.error.code).not.toBe('CONTACT_UNVERIFIED');
  });
});
