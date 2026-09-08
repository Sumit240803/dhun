import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { closePool } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'phone-change-device', platform: 'android' };
const PASSWORD = 'correct horse battery';

let counter = 0;
const nextPhone = () => `+9198${String(Date.now()).slice(-6)}${String(counter++).padStart(2, '0')}`;
const nextEmail = () => `pc${counter++}.${Date.now()}@example.com`;

/** Signs in by phone, the way most accounts here exist. */
async function phoneAccount(deviceId = DEVICE.deviceId) {
  const phone = nextPhone();
  const sent = await request(app)
    .post('/v1/auth/otp/request')
    .send({ phone, channel: 'sms' })
    .expect(200);

  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: sent.body.devCode, device: { ...DEVICE, deviceId } })
    .expect(200);

  return {
    phone,
    ...(res.body as { accessToken: string; refreshToken: string; user: { id: string } }),
  };
}

async function emailAccount(deviceId = DEVICE.deviceId) {
  const email = nextEmail();
  const res = await request(app)
    .post('/v1/auth/email/register')
    .send({ email, password: PASSWORD, device: { ...DEVICE, deviceId } })
    .expect(201);

  return {
    email,
    ...(res.body as { accessToken: string; refreshToken: string; user: { id: string } }),
  };
}

/** The code for the live phone-change challenge, read the only way a test can. */
async function changeCode(phone: string): Promise<string> {
  const sent = await request(app)
    .post('/v1/auth/otp/request')
    .send({ phone, channel: 'sms' })
    .expect(200);
  return sent.body.devCode as string;
}

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(closePool);

describe('starting a phone change', () => {
  it('sends a code to the new number', async () => {
    const account = await phoneAccount();
    const target = nextPhone();

    const res = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, channel: 'sms' })
      .expect(200);

    expect(res.body.devCode).toMatch(/^\d{6}$/);

    const { rows } = await pool.query<{ purpose: string }>(
      'SELECT purpose FROM otp_challenges WHERE phone_e164 = $1 ORDER BY created_at DESC LIMIT 1',
      [target],
    );
    expect(rows[0].purpose).toBe('phone_change');
  });

  it('needs the password when the account has one', async () => {
    // The threat is a borrowed unlocked phone, not a stranger. Without this,
    // temporary access to a signed-in device becomes permanent ownership.
    const account = await emailAccount();

    const missing = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: nextPhone(), channel: 'sms' })
      .expect(422);
    expect(missing.body.error.code).toBe('PASSWORD_REQUIRED');

    const wrong = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: nextPhone(), channel: 'sms', password: 'not it' })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a number another account already uses, without texting it', async () => {
    const account = await phoneAccount();
    const other = await phoneAccount('phone-change-other-dev');

    const res = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: other.phone, channel: 'sms' })
      .expect(409);

    expect(res.body.error.code).toBe('PHONE_TAKEN');

    // Nothing was sent. Otherwise anyone signed in could make us text a
    // stranger on demand.
    const { rows } = await pool.query(
      "SELECT 1 FROM otp_challenges WHERE phone_e164 = $1 AND purpose = 'phone_change'",
      [other.phone],
    );
    expect(rows).toHaveLength(0);
  });

  it('refuses the number the account already has', async () => {
    const account = await phoneAccount();

    const res = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: account.phone, channel: 'sms' })
      .expect(409);

    expect(res.body.error.code).toBe('PHONE_UNCHANGED');
  });

  it('is closed to guests', async () => {
    // A guest has no number to move. The signup path is what they want, and
    // letting this through would be a second, less guarded way to register.
    const guest = await request(app)
      .post('/v1/auth/guest')
      .send({ device: { ...DEVICE, deviceId: 'phone-change-guest' } })
      .expect(201);

    await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .send({ phone: nextPhone(), channel: 'sms' })
      .expect(403);
  });
});

describe('completing a phone change', () => {
  it('moves the number and returns the updated user', async () => {
    const account = await phoneAccount();
    const target = nextPhone();

    const started = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, channel: 'sms' })
      .expect(200);

    const res = await request(app)
      .post('/v1/auth/phone/change/verify')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, code: started.body.devCode, keepDeviceId: DEVICE.deviceId })
      .expect(200);

    expect(res.body.phone).toBe(target);
    expect(res.body.user.phone).toBe(target);

    const { rows } = await pool.query<{ phone_e164: string; verified: Date | null }>(
      'SELECT phone_e164, phone_verified_at AS verified FROM users WHERE id = $1',
      [account.user.id],
    );
    expect(rows[0].phone_e164).toBe(target);
    // Verified by the OTP that just landed, not carried over from the old one.
    expect(rows[0].verified).not.toBeNull();
  });

  it('records the change, with the old number and the device', async () => {
    // The support ticket after a takeover starts with "when did my number
    // change, and from which device". Without this row there is no answer.
    const account = await phoneAccount();
    const target = nextPhone();

    const started = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, channel: 'sms' })
      .expect(200);

    await request(app)
      .post('/v1/auth/phone/change/verify')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, code: started.body.devCode, keepDeviceId: DEVICE.deviceId })
      .expect(200);

    const { rows } = await pool.query<{
      old_phone: string | null;
      new_phone: string;
      device_id: string | null;
    }>('SELECT old_phone, new_phone, device_id FROM phone_changes WHERE user_id = $1', [
      account.user.id,
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].old_phone).toBe(account.phone);
    expect(rows[0].new_phone).toBe(target);
    expect(rows[0].device_id).toBe(DEVICE.deviceId);
  });

  it('signs out the other devices and keeps this one', async () => {
    const account = await phoneAccount('phone-change-keep');
    const sent = await request(app)
      .post('/v1/auth/otp/request')
      .send({ phone: account.phone, channel: 'sms' })
      .expect(200);
    const other = await request(app)
      .post('/v1/auth/otp/verify')
      .send({
        phone: account.phone,
        code: sent.body.devCode,
        device: { ...DEVICE, deviceId: 'phone-change-drop' },
      })
      .expect(200);

    const target = nextPhone();
    const started = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, channel: 'sms' })
      .expect(200);

    await request(app)
      .post('/v1/auth/phone/change/verify')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, code: started.body.devCode, keepDeviceId: 'phone-change-keep' })
      .expect(200);

    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken })
      .expect(200);

    // If the change was not the owner's doing, signing the attacker out is the
    // only thing that still helps them.
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: other.body.refreshToken })
      .expect(401);
  });

  it('leaves the old number free for someone else', async () => {
    const account = await phoneAccount();
    const target = nextPhone();

    const started = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, channel: 'sms' })
      .expect(200);

    await request(app)
      .post('/v1/auth/phone/change/verify')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, code: started.body.devCode })
      .expect(200);

    // Indian numbers get recycled. Signing up on the released one must work,
    // and must land on a NEW account rather than the one that moved away.
    const sent = await request(app)
      .post('/v1/auth/otp/request')
      .send({ phone: account.phone, channel: 'sms' })
      .expect(200);

    const res = await request(app)
      .post('/v1/auth/otp/verify')
      .send({
        phone: account.phone,
        code: sent.body.devCode,
        device: { ...DEVICE, deviceId: 'phone-change-recycled' },
      })
      .expect(200);

    expect(res.body.user.id).not.toBe(account.user.id);
  });

  it('refuses a sign-in code presented as a change code', async () => {
    // `purpose` is the whole reason otp_challenges gained a column. Without it
    // a code minted for one flow authorises the other.
    const account = await phoneAccount();
    const target = nextPhone();

    await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, channel: 'sms' })
      .expect(200);

    // A plain sign-in code for the same number, requested afterwards so it is
    // the most recent challenge on that phone.
    const signin = await changeCode(target);

    const res = await request(app)
      .post('/v1/auth/phone/change/verify')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, code: signin })
      .expect(401);

    expect(res.body.error.code).toBe('OTP_INVALID');
  });

  it('refuses a wrong code and counts the attempt', async () => {
    const account = await phoneAccount();
    const target = nextPhone();

    await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, channel: 'sms' })
      .expect(200);

    await request(app)
      .post('/v1/auth/phone/change/verify')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, code: '000000' })
      .expect(401);

    const { rows } = await pool.query<{ attempts: number }>(
      `SELECT attempts FROM otp_challenges
        WHERE phone_e164 = $1 AND purpose = 'phone_change'
        ORDER BY created_at DESC LIMIT 1`,
      [target],
    );
    expect(rows[0].attempts).toBe(1);

    // The number did not move.
    const user = await pool.query<{ phone_e164: string }>(
      'SELECT phone_e164 FROM users WHERE id = $1',
      [account.user.id],
    );
    expect(user.rows[0].phone_e164).toBe(account.phone);
  });

  it('refuses a number claimed between the request and the verify', async () => {
    // Minutes pass between the two calls. The first check goes stale, and
    // without the second one this surfaces as a constraint violation instead
    // of a sentence anyone can act on.
    const account = await phoneAccount();
    const target = nextPhone();

    const started = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, channel: 'sms' })
      .expect(200);

    const sent = await request(app)
      .post('/v1/auth/otp/request')
      .send({ phone: target, channel: 'sms' })
      .expect(200);
    await request(app)
      .post('/v1/auth/otp/verify')
      .send({
        phone: target,
        code: sent.body.devCode,
        device: { ...DEVICE, deviceId: 'phone-change-racer' },
      })
      .expect(200);

    const res = await request(app)
      .post('/v1/auth/phone/change/verify')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, code: started.body.devCode })
      .expect(409);

    expect(res.body.error.code).toBe('PHONE_TAKEN');
  });
});

describe('sign-in is unaffected by the new purpose column', () => {
  it('still refuses a phone-change code at the sign-in endpoint', async () => {
    const account = await phoneAccount();
    const target = nextPhone();

    const started = await request(app)
      .post('/v1/auth/phone/change/request')
      .set('Authorization', `Bearer ${account.accessToken}`)
      .send({ phone: target, channel: 'sms' })
      .expect(200);

    await request(app)
      .post('/v1/auth/otp/verify')
      .send({
        phone: target,
        code: started.body.devCode,
        device: { ...DEVICE, deviceId: 'phone-change-crossuse' },
      })
      .expect(400);
  });
});
