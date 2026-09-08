import { createHmac } from 'crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { closePool } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'account-device-01', platform: 'android' };
const PASSWORD = 'correct horse battery';

let counter = 0;
const nextEmail = () => `acct${counter++}.${Date.now()}@example.com`;

async function register(email = nextEmail(), deviceId = DEVICE.deviceId) {
  const res = await request(app)
    .post('/v1/auth/email/register')
    .send({ email, password: PASSWORD, device: { ...DEVICE, deviceId } })
    .expect(201);
  return {
    email,
    ...(res.body as {
      accessToken: string;
      refreshToken: string;
      user: { id: string };
    }),
  };
}

/** Writes a hash for a code the test knows. The plaintext is unrecoverable by design. */
async function setResetCode(userId: string, code: string) {
  const hash = createHmac('sha256', process.env.JWT_SECRET!).update(code).digest('hex');
  await pool.query(
    `UPDATE email_verifications SET code_hash = $2
      WHERE id = (SELECT id FROM email_verifications
                   WHERE user_id = $1 AND purpose = 'reset' AND consumed_at IS NULL
                   ORDER BY created_at DESC LIMIT 1)`,
    [userId, hash],
  );
}

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(closePool);

describe('forgetting a password', () => {
  it('answers identically for an unknown address', async () => {
    // Anything else turns this into an account-existence oracle — the same
    // leak the login path is careful to avoid.
    const account = await register();

    const known = await request(app)
      .post('/v1/auth/email/password/forgot')
      .send({ email: account.email })
      .expect(202);

    const unknown = await request(app)
      .post('/v1/auth/email/password/forgot')
      .send({ email: nextEmail() })
      .expect(202);

    expect(unknown.body).toEqual(known.body);
  });

  it('mints no code for a phone-only account that happens to carry an email', async () => {
    // Otherwise resetting would be a way to ADD a password to an account you
    // do not control.
    const guest = await request(app).post('/v1/auth/guest').send({ device: DEVICE }).expect(201);
    const email = nextEmail();
    await pool.query('UPDATE users SET email = $2 WHERE id = $1', [guest.body.user.id, email]);

    await request(app).post('/v1/auth/email/password/forgot').send({ email }).expect(202);

    const { rows } = await pool.query(
      `SELECT 1 FROM email_verifications WHERE user_id = $1 AND purpose = 'reset'`,
      [guest.body.user.id],
    );
    expect(rows).toHaveLength(0);
  });
});

describe('resetting a password', () => {
  it('sets the new password and signs every device out', async () => {
    // Someone resetting because they were compromised would otherwise leave
    // the attacker signed in — the reset would change the password and nothing
    // else.
    const account = await register();

    await request(app)
      .post('/v1/auth/email/password/forgot')
      .send({ email: account.email })
      .expect(202);
    await setResetCode(account.user.id, '654321');

    await request(app)
      .post('/v1/auth/email/password/reset')
      .send({ email: account.email, code: '654321', password: 'a brand new passphrase' })
      .expect(200);

    // The old refresh token is dead.
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken })
      .expect(401);

    // The old password no longer works, the new one does.
    await request(app)
      .post('/v1/auth/email/login')
      .send({ email: account.email, password: PASSWORD, device: DEVICE })
      .expect(401);

    await request(app)
      .post('/v1/auth/email/login')
      .send({ email: account.email, password: 'a brand new passphrase', device: DEVICE })
      .expect(200);
  });

  it('counts a wrong code even though the request fails', async () => {
    const account = await register();
    await request(app)
      .post('/v1/auth/email/password/forgot')
      .send({ email: account.email })
      .expect(202);

    await request(app)
      .post('/v1/auth/email/password/reset')
      .send({ email: account.email, code: '000000', password: 'another passphrase' })
      .expect(401);

    const { rows } = await pool.query<{ attempts: number }>(
      `SELECT attempts FROM email_verifications
        WHERE user_id = $1 AND purpose = 'reset' ORDER BY created_at DESC LIMIT 1`,
      [account.user.id],
    );
    expect(rows[0].attempts).toBe(1);
  });

  it('refuses a verification code used as a reset code', async () => {
    // `purpose` is the only thing stopping a code minted for one flow being
    // spent on the other, and that would be a real takeover.
    const account = await register();
    await setResetCode(account.user.id, '111111'); // no reset code exists yet

    await request(app)
      .post('/v1/auth/email/password/reset')
      .send({ email: account.email, code: '111111', password: 'another passphrase' })
      .expect(400);
  });

  it('refuses a short new password', async () => {
    const account = await register();
    await request(app)
      .post('/v1/auth/email/password/forgot')
      .send({ email: account.email })
      .expect(202);
    await setResetCode(account.user.id, '654321');

    await request(app)
      .post('/v1/auth/email/password/reset')
      .send({ email: account.email, code: '654321', password: 'short' })
      .expect(422);
  });
});

describe('changing a password', () => {
  it('requires the current one', async () => {
    const account = await register();

    const res = await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ currentPassword: 'not it', newPassword: 'a brand new passphrase' })
      .expect(401);

    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('keeps this device signed in and signs the others out', async () => {
    const account = await register(undefined, 'change-device-keep');
    const other = await request(app)
      .post('/v1/auth/email/login')
      .send({
        email: account.email,
        password: PASSWORD,
        device: { ...DEVICE, deviceId: 'change-device-other' },
      })
      .expect(200);

    await request(app)
      .post('/v1/auth/password/change')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({
        currentPassword: PASSWORD,
        newPassword: 'a brand new passphrase',
        keepDeviceId: 'change-device-keep',
      })
      .expect(200);

    // Signing out of the device in your hand reads as a failure, not security.
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken })
      .expect(200);

    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: other.body.refreshToken })
      .expect(401);
  });
});

describe('sessions', () => {
  it('lists a device per live session, with this one first', async () => {
    const account = await register(undefined, 'session-device-a');
    await request(app)
      .post('/v1/auth/email/login')
      .send({
        email: account.email,
        password: PASSWORD,
        device: { ...DEVICE, deviceId: 'session-device-b' },
      })
      .expect(200);

    const res = await request(app)
      .get('/v1/auth/sessions?deviceId=session-device-a')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions[0].deviceId).toBe('session-device-a');
    expect(res.body.sessions[0].current).toBe(true);
  });

  it('drops a device once its session is revoked', async () => {
    // A device with no live token is not a session, and listing it would make
    // "sign out everywhere" look like it did nothing.
    const account = await register(undefined, 'session-device-c');
    await request(app)
      .post('/v1/auth/email/login')
      .send({
        email: account.email,
        password: PASSWORD,
        device: { ...DEVICE, deviceId: 'session-device-d' },
      })
      .expect(200);

    await request(app)
      .delete('/v1/auth/sessions/session-device-d')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    const res = await request(app)
      .get('/v1/auth/sessions')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .expect(200);

    expect(res.body.sessions.map((s: { deviceId: string }) => s.deviceId)).toEqual([
      'session-device-c',
    ]);
  });
});

describe('deleting an account', () => {
  it('requires the password when the account has one', async () => {
    const account = await register();

    const res = await request(app)
      .post('/v1/auth/account/delete')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({})
      .expect(422);

    expect(res.body.error.code).toBe('PASSWORD_REQUIRED');
  });

  it('anonymises the identity and ends every session', async () => {
    const account = await register();

    await request(app)
      .post('/v1/auth/account/delete')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ password: PASSWORD })
      .expect(200);

    const { rows } = await pool.query<{
      status: string;
      email: string | null;
      phone_e164: string | null;
      password_hash: string | null;
    }>('SELECT status, email, phone_e164, password_hash FROM users WHERE id = $1', [
      account.user.id,
    ]);

    // The ROW survives — the ledger is append-only and its entries point here.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('deleted');
    expect(rows[0].email).toBeNull();
    expect(rows[0].password_hash).toBeNull();

    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken })
      .expect(401);
  });

  it('frees the address for reuse', async () => {
    // Deleting and signing up again with the same address is ordinary, and
    // must not hit a unique constraint.
    const account = await register();

    await request(app)
      .post('/v1/auth/account/delete')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ password: PASSWORD })
      .expect(200);

    await request(app)
      .post('/v1/auth/email/register')
      .send({ email: account.email, password: PASSWORD, device: DEVICE })
      .expect(201);
  });

  it('clears the profile and the devices', async () => {
    const account = await register();
    await request(app)
      .patch('/v1/auth/profile')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ displayName: 'Rahul', dateOfBirth: '1998-04-12' })
      .expect(200);

    await request(app)
      .post('/v1/auth/account/delete')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ password: PASSWORD })
      .expect(200);

    const profile = await pool.query<{ display_name: string | null }>(
      'SELECT display_name FROM user_profiles WHERE user_id = $1',
      [account.user.id],
    );
    expect(profile.rows[0].display_name).toBeNull();

    // Push tokens are personal data AND a delivery channel. Both reasons to go.
    const devices = await pool.query('SELECT 1 FROM user_devices WHERE user_id = $1', [
      account.user.id,
    ]);
    expect(devices.rows).toHaveLength(0);
  });
});
