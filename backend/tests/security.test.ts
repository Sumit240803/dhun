import { randomUUID } from 'crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'sec-device-000001', platform: 'android' };

let phoneCounter = 0;
const nextPhone = () => `+9196${String(30_000_000 + phoneCounter++).slice(-8)}`;
const nextDevice = () => ({ deviceId: `sec-dev-${randomUUID()}`, platform: 'android' as const });

async function registeredUser(opts: { adult?: boolean } = {}) {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone });
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: nextDevice() });

  const token = res.body.accessToken as string;
  if (opts.adult !== false) {
    await request(app)
      .patch('/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ dateOfBirth: '1995-06-15' });
  }
  return { id: res.body.user.id as string, token };
}

beforeEach(resetLedger);
afterAll(closePool);

describe('security headers', () => {
  it('sets the hardening headers on every response', async () => {
    const res = await request(app).get('/health').expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    // Leaking the framework and version tells an attacker which CVEs to try.
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects a cross-origin request from an unlisted origin', async () => {
    const res = await request(app)
      .options('/v1/auth/guest')
      .set('Origin', 'https://evil.example')
      .expect(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('input validation', () => {
  it('rejects unknown fields rather than silently ignoring them', async () => {
    const res = await request(app)
      .post('/v1/auth/otp/request')
      .send({ phone: nextPhone(), channel: 'whatsapp', isAdmin: true })
      .expect(422);

    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.issues[0].message).toBe('Unknown field');
  });

  it('blocks prototype pollution keys', async () => {
    const res = await request(app)
      .post('/v1/auth/guest')
      .set('Content-Type', 'application/json')
      // Sent as a raw string: JSON.stringify would drop __proto__ before it left.
      .send('{"device":{"deviceId":"aaaaaaaaaa","platform":"android","__proto__":{"admin":true}}}')
      .expect(400);

    expect(res.body.error.code).toBe('UNSAFE_PAYLOAD');
  });

  it('never echoes the caller\'s own input back in an error', async () => {
    const evil = '<script>alert(1)</script>';
    const res = await request(app)
      .post('/v1/auth/otp/request')
      .send({ phone: nextPhone(), channel: evil })
      .expect(422);

    // Reflecting input is how a JSON error becomes an XSS vector once a client
    // renders it.
    expect(JSON.stringify(res.body)).not.toContain('script');
    expect(res.body.error.details.issues[0].message).toBe('Not one of the allowed values');
  });

  it('validates query parameters, not just bodies', async () => {
    const user = await registeredUser();
    const res = await request(app)
      .get('/v1/wallet/transactions?limit=99999')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(422);

    expect(res.body.error.details.issues[0].field).toBe('query.limit');
  });

  it('rejects a non-uuid cursor', async () => {
    const user = await registeredUser();
    await request(app)
      .get('/v1/wallet/transactions?before=not-a-uuid')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(422);
  });

  it('bounds a conversion amount at both ends', async () => {
    const user = await registeredUser();
    for (const coins of [0, -5, 999_999_999]) {
      await request(app)
        .post('/v1/wallet/convert')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ coins })
        .expect(422);
    }
  });

  it('rejects a fractional coin amount', async () => {
    const user = await registeredUser();
    await request(app)
      .post('/v1/wallet/convert')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ coins: 100.5 })
      .expect(422);
  });
});

describe('malformed requests', () => {
  it('returns a clean 400 for invalid JSON', async () => {
    const res = await request(app)
      .post('/v1/auth/guest')
      .set('Content-Type', 'application/json')
      .send('{"device": ')
      .expect(400);

    expect(res.body.error.code).toBe('BAD_JSON');
    expect(res.body.error.trace_id).toBeTruthy();
  });

  it('requires a JSON content type on bodied requests', async () => {
    const res = await request(app)
      .post('/v1/auth/guest')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('deviceId=abc')
      .expect(415);

    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an oversized body', async () => {
    const res = await request(app)
      .post('/v1/auth/guest')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ device: { deviceId: 'x'.repeat(300_000), platform: 'android' } }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('error message sanitisation', () => {
  it('gives every error a code, a message and a trace id', async () => {
    const res = await request(app).get('/v1/nope').expect(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.trace_id).toBeTruthy();
  });

  it('never leaks a stack trace, SQL, or a file path', async () => {
    const responses = await Promise.all([
      request(app).get('/v1/nope'),
      request(app).get('/v1/auth/me'),
      request(app).post('/v1/auth/refresh').send({ refreshToken: 'x'.repeat(40) }),
      request(app).post('/v1/auth/otp/request').send({ phone: 'bad' }),
    ]);

    for (const res of responses) {
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/at [\w.]+ \(/); // stack frame
      expect(body).not.toMatch(/\.ts:\d+/); // source location
      expect(body).not.toMatch(/SELECT |INSERT |node_modules/i);
    }
  });

  it('does not disclose whether a phone number is registered', async () => {
    const phone = nextPhone();
    const unknown = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);

    await request(app)
      .post('/v1/auth/otp/verify')
      .send({ phone, code: unknown.body.devCode, device: nextDevice() })
      .expect(200);

    // The second request to a NOW-REGISTERED number must look identical to the
    // first, or the endpoint becomes a way to enumerate who has an account.
    const known = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
    expect(Object.keys(known.body).sort()).toEqual(Object.keys(unknown.body).sort());
  });
});

describe('rate limiting', () => {
  it('caps guest creation per device', async () => {
    const device = nextDevice();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/v1/auth/guest').send({ device }).expect(201);
    }

    const res = await request(app).post('/v1/auth/guest').send({ device }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeTruthy();
  });

  it('publishes the limit headers', async () => {
    const res = await request(app).post('/v1/auth/guest').send({ device: nextDevice() });
    expect(res.headers['ratelimit-limit']).toBeTruthy();
    expect(res.headers['ratelimit-remaining']).toBeTruthy();
  });
});

describe('the 18+ gate', () => {
  it('refuses to move money for a user with no date of birth', async () => {
    const user = await registeredUser({ adult: false });

    const res = await request(app)
      .post('/v1/wallet/purchase/iap')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ packId: 'small_99', purchaseToken: `stub-${randomUUID()}` })
      .expect(403);

    // A distinct code, so the app can open the date picker rather than show a
    // dead end.
    expect(res.body.error.code).toBe('DOB_REQUIRED');
  });

  it('refuses a minor even when the date of birth is supplied', async () => {
    const user = await registeredUser({ adult: false });
    const minor = new Date();
    minor.setFullYear(minor.getFullYear() - 16);

    await request(app)
      .patch('/v1/auth/profile')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ dateOfBirth: minor.toISOString().slice(0, 10) })
      .expect(403);

    // The profile write was refused, so the gate still reports a missing DOB.
    const res = await request(app)
      .post('/v1/wallet/convert')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ coins: 200 })
      .expect(403);

    expect(['DOB_REQUIRED', 'FORBIDDEN']).toContain(res.body.error.code);
  });

  it('lets a verified adult through', async () => {
    const user = await registeredUser();
    const res = await request(app)
      .post('/v1/wallet/convert')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ coins: 200 })
      .expect(402); // reaches the balance check — the gate is behind us

    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
  });
});
