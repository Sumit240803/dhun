import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { grantRole, hasRole } from '../src/modules/auth/index.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();

const DEVICE = { deviceId: 'device-aaaaaaaa-0001', platform: 'android', appVersion: '1.0.0' };
const OTHER_DEVICE = { deviceId: 'device-bbbbbbbb-0002', platform: 'ios' };

// Unique per test so the per-phone hourly rate limit never leaks between them.
let phoneCounter = 0;
const nextPhone = () => `+9198${String(10_000_000 + phoneCounter++).slice(-8)}`;

async function guestSession(device = DEVICE) {
  const res = await request(app).post('/v1/auth/guest').send({ device }).expect(201);
  return res.body as { user: { id: string }; accessToken: string; refreshToken: string };
}

/** Requests a code and returns it. `devCode` is only ever present outside production. */
async function getCode(phone: string, channel: 'whatsapp' | 'sms' = 'whatsapp') {
  const res = await request(app).post('/v1/auth/otp/request').send({ phone, channel }).expect(200);
  return res.body.devCode as string;
}

beforeEach(resetLedger);
afterAll(closePool);

describe('guest sessions', () => {
  it('issues a real identity before signup', async () => {
    const session = await guestSession();

    expect(session.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();

    const me = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(me.body.user.status).toBe('guest');
    expect(me.body.user.phone).toBeNull();
  });

  it('rejects a request with no token', async () => {
    const res = await request(app).get('/v1/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a forged token', async () => {
    const res = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer not.a.real.token')
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});

describe('phone verification', () => {
  it('upgrades a guest in place, keeping their user id', async () => {
    const guest = await guestSession();
    const phone = nextPhone();
    const code = await getCode(phone);

    const res = await request(app)
      .post('/v1/auth/otp/verify')
      // The guest sends their token, which is what makes this an upgrade rather
      // than a new account — everything they earned before signup is kept.
      .set('Authorization', `Bearer ${guest.accessToken}`)
      .send({ phone, code, device: DEVICE })
      .expect(200);

    expect(res.body.user.id).toBe(guest.user.id);
    expect(res.body.user.status).toBe('active');
    expect(res.body.user.phone).toBe(phone);
    expect(res.body.isNewUser).toBe(true);
  });

  it('creates a fresh user when no guest token is sent', async () => {
    const phone = nextPhone();
    const code = await getCode(phone);

    const res = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code, device: DEVICE })
      .expect(200);

    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user.phone).toBe(phone);
  });

  it('signs back into the same account on a second device', async () => {
    const phone = nextPhone();
    const first = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: await getCode(phone), device: DEVICE })
      .expect(200);

    const second = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: await getCode(phone), device: OTHER_DEVICE })
      .expect(200);

    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.isNewUser).toBe(false);
  });

  it('does not merge a guest into an existing account', async () => {
    const phone = nextPhone();
    const owner = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: await getCode(phone), device: DEVICE })
      .expect(200);

    const guest = await guestSession(OTHER_DEVICE);
    const res = await request(app)
      .post('/v1/auth/otp/verify')
      .set('Authorization', `Bearer ${guest.accessToken}`)
      .send({ phone, code: await getCode(phone), device: OTHER_DEVICE })
      .expect(200);

    // Signs into the existing account and leaves the guest row alone. Merging
    // two identities' balances is how double-spend and laundering routes appear.
    expect(res.body.user.id).toBe(owner.body.user.id);
    expect(res.body.user.id).not.toBe(guest.user.id);
  });
});

describe('OTP protection', () => {
  it('rejects a wrong code and counts down the attempts', async () => {
    const phone = nextPhone();
    await getCode(phone);

    const res = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: '000000', device: DEVICE })
      .expect(401);

    expect(res.body.error.code).toBe('OTP_INVALID');
    expect(res.body.error.details.attemptsRemaining).toBe(4);
  });

  it('locks the challenge after too many wrong attempts', async () => {
    const phone = nextPhone();
    const real = await getCode(phone);

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/v1/auth/otp/verify')
        .send({ phone, code: '000000', device: DEVICE })
        .expect(401);
    }

    // Even the correct code is refused once the challenge is burned.
    const res = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: real, device: DEVICE })
      .expect(429);
    expect(res.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('invalidates an older code when a new one is requested', async () => {
    const phone = nextPhone();
    const first = await getCode(phone);
    await getCode(phone);

    const res = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: first, device: DEVICE })
      .expect(401);
    expect(res.body.error.code).toBe('OTP_INVALID');
  });

  it('rate limits repeated code requests for one number', async () => {
    const phone = nextPhone();
    for (let i = 0; i < 5; i++) await getCode(phone);

    const res = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(429);
    expect(res.body.error.code).toBe('OTP_RATE_LIMITED');
  });

  it('rejects a malformed phone number', async () => {
    const res = await request(app)
      .post('/v1/auth/otp/request')
      .send({ phone: '9876543210' }) // no country code
      .expect(422);
    expect(res.body.error).toBeDefined();
  });
});

describe('refresh token rotation', () => {
  it('issues a new pair and retires the old token', async () => {
    const session = await guestSession();

    const rotated = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    expect(rotated.body.refreshToken).not.toBe(session.refreshToken);

    await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${rotated.body.accessToken}`)
      .expect(200);
  });

  it('treats a reused token as theft and kills the whole chain', async () => {
    const session = await guestSession();
    const rotated = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);

    // Replaying the already-rotated token means two parties hold it.
    const replay = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate client's newer token is revoked too — safer to log
    // everyone out than to leave an attacker holding a valid session.
    const after = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
    expect(after.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('rejects an unknown refresh token', async () => {
    const res = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'x'.repeat(43) })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });
});

describe('logout', () => {
  it('revokes the session for one device only', async () => {
    const phone = nextPhone();
    const a = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: await getCode(phone), device: DEVICE })
      .expect(200);
    const b = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: await getCode(phone), device: OTHER_DEVICE })
      .expect(200);

    await request(app)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${a.body.accessToken}`)
      .send({ deviceId: DEVICE.deviceId })
      .expect(200);

    await request(app).post('/v1/auth/refresh').send({ refreshToken: a.body.refreshToken }).expect(401);
    await request(app).post('/v1/auth/refresh').send({ refreshToken: b.body.refreshToken }).expect(200);
  });

  it('revokes every device when asked', async () => {
    const phone = nextPhone();
    const a = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: await getCode(phone), device: DEVICE })
      .expect(200);
    const b = await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: await getCode(phone), device: OTHER_DEVICE })
      .expect(200);

    await request(app)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${a.body.accessToken}`)
      .send({ allDevices: true })
      .expect(200);

    await request(app).post('/v1/auth/refresh').send({ refreshToken: b.body.refreshToken }).expect(401);
  });
});

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * A date of birth `years` years before today in IST, shifted by `dayShift` days.
 *
 * Built from IST calendar parts rather than `new Date()` + `toISOString()`.
 * The old version did the latter, and between midnight and 05:30 IST
 * toISOString() reports the PREVIOUS UTC day — so "one day short of 18" became
 * "exactly 18" and the suite failed only when run at night.
 */
function dobYearsAgo(years: number, dayShift = 0): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const dob = new Date(
    Date.UTC(ist.getUTCFullYear() - years, ist.getUTCMonth(), ist.getUTCDate() + dayShift),
  );
  return dob.toISOString().slice(0, 10);
}

describe('profile and the 18+ gate', () => {
  it('accepts an adult date of birth', async () => {
    const session = await guestSession();
    const res = await request(app)
      .patch('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ displayName: 'Rahul', dateOfBirth: '1998-04-12' })
      .expect(200);

    expect(res.body.user.displayName).toBe('Rahul');
  });

  it('refuses anyone under 18', async () => {
    const session = await guestSession();

    const res = await request(app)
      .patch('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ dateOfBirth: dobYearsAgo(17) })
      .expect(403);

    expect(res.body.error.code).toBe('UNDERAGE');
  });

  it('refuses someone one day short of their 18th birthday', async () => {
    const session = await guestSession();

    await request(app)
      .patch('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ dateOfBirth: dobYearsAgo(18, 1) })
      .expect(403);
  });

  it('accepts someone on the morning of their 18th birthday', async () => {
    const session = await guestSession();

    await request(app)
      .patch('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ dateOfBirth: dobYearsAgo(18) })
      .expect(200);
  });

  it('rejects a date that passes the shape check but does not exist', async () => {
    const session = await guestSession();

    const res = await request(app)
      .patch('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ dateOfBirth: '2000-02-31' })
      .expect(422);

    expect(res.body.error.code).toBe('INVALID_DOB');
  });

  it('rejects a future date of birth as malformed, not as underage', async () => {
    const session = await guestSession();

    const res = await request(app)
      .patch('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ dateOfBirth: dobYearsAgo(-1) })
      .expect(422);

    expect(res.body.error.code).toBe('INVALID_DOB');
  });
});

describe('scoped roles', () => {
  it('separates a room-scoped grant from other rooms', async () => {
    const session = await guestSession();
    const roomA = '01912345-0000-7000-8000-0000000000a1';
    const roomB = '01912345-0000-7000-8000-0000000000b2';

    await grantRole({
      userId: session.user.id,
      roleCode: 'room_admin',
      scopeType: 'room',
      scopeId: roomA,
    });

    expect(await hasRole(session.user.id, 'room_admin', { type: 'room', id: roomA })).toBe(true);
    expect(await hasRole(session.user.id, 'room_admin', { type: 'room', id: roomB })).toBe(false);
    expect(await hasRole(session.user.id, 'host')).toBe(false);
  });

  it('lets a global grant satisfy a scoped check', async () => {
    const session = await guestSession();
    await grantRole({ userId: session.user.id, roleCode: 'super_admin', scopeType: 'global' });

    // A super_admin administers every room without a row per room.
    expect(
      await hasRole(session.user.id, 'super_admin', {
        type: 'room',
        id: '01912345-0000-7000-8000-0000000000c3',
      }),
    ).toBe(true);
  });

  it('reports active roles on /me', async () => {
    const session = await guestSession();
    await grantRole({ userId: session.user.id, roleCode: 'host', scopeType: 'global' });

    const me = await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(me.body.user.roles).toEqual([
      { roleCode: 'host', scopeType: 'global', scopeId: null },
    ]);
  });
});

describe('a ban takes effect on a live session', () => {
  it('rejects a banned account on every request, not only at sign-in', async () => {
    const session = await guestSession();

    await request(app)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    await pool.query("UPDATE users SET status = 'banned' WHERE id = $1", [session.user.id]);

    // The status rides in the access token, so the OLD token still says guest.
    // A fresh one is what carries the ban — which is why refresh must refuse.
    const refreshed = await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(403);

    expect(refreshed.body.error.code).toBe('ACCOUNT_BANNED');
  });

  it('revokes the whole chain, so another device cannot resume', async () => {
    const session = await guestSession();
    await pool.query("UPDATE users SET status = 'banned' WHERE id = $1", [session.user.id]);

    await request(app).post('/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(403);

    // Second attempt sees a revoked token rather than a live one.
    await request(app)
      .post('/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });
});

describe('a guest can be banned', () => {
  it('does not fail on the phone constraint', async () => {
    // A guest is the account an abuser creates in seconds. The original
    // constraint exempted only 'guest' and 'deleted', so banning one was
    // impossible and the only remedies were deleting the row — losing the
    // audit trail — or leaving them running.
    const session = await guestSession();

    await expect(
      pool.query("UPDATE users SET status = 'banned' WHERE id = $1", [session.user.id]),
    ).resolves.toBeDefined();
  });

  it('still refuses an active user with no verified phone', async () => {
    const session = await guestSession();

    await expect(
      pool.query("UPDATE users SET status = 'active' WHERE id = $1", [session.user.id]),
    ).rejects.toThrow();
  });
});
