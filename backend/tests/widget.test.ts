import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { closePool } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'widget-device-0001', platform: 'android' };
const TOKEN = 'a-token-the-client-claims-msg91-gave-it';

/**
 * Stands in for MSG91.
 *
 * The whole point of these tests is what happens when the provider says
 * something other than a clean success — which is most of the interesting
 * cases and none of the ones a live integration would let us reproduce.
 */
function mockMsg91(response: { ok: boolean; status?: number; body: unknown } | Error) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? (response.ok ? 200 : 400),
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

beforeEach(async () => {
  await resetRateLimits();
  await pool.query('DELETE FROM refresh_tokens');
  await pool.query('DELETE FROM user_devices');
  await pool.query('DELETE FROM user_profiles');
  await pool.query("DELETE FROM users WHERE phone_e164 LIKE '+9193%'");
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(closePool);

function verify(token = TOKEN) {
  return request(app).post('/v1/auth/otp/widget/verify').send({ accessToken: token, device: DEVICE });
}

describe('widget sign-in', () => {
  it('signs in when MSG91 confirms the token', async () => {
    mockMsg91({ ok: true, body: { type: 'success', message: '919312345678' } });

    const res = await verify().expect(200);

    expect(res.body.accessToken).toBeTruthy();
    // MSG91 returns digits with no '+', and everything downstream assumes E.164.
    expect(res.body.user.phone).toBe('+919312345678');
    expect(res.body.isNewUser).toBe(true);
  });

  it('signs the same person back into the same account', async () => {
    mockMsg91({ ok: true, body: { type: 'success', message: '919312345679' } });

    const first = await verify().expect(200);
    const second = await verify().expect(200);

    expect(second.body.user.id).toBe(first.body.user.id);
    expect(second.body.isNewUser).toBe(false);
  });

  it('upgrades a guest in place, keeping their id', async () => {
    const guest = await request(app).post('/v1/auth/guest').send({ device: DEVICE }).expect(201);
    mockMsg91({ ok: true, body: { type: 'success', message: '919312345680' } });

    const res = await request(app)
      .post('/v1/auth/otp/widget/verify')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .send({ accessToken: TOKEN, device: DEVICE })
      .expect(200);

    expect(res.body.user.id).toBe(guest.body.user.id);
  });
});

describe('widget sign-in fails closed', () => {
  it('refuses when MSG91 rejects the token', async () => {
    mockMsg91({ ok: false, status: 400, body: { type: 'error', message: 'invalid token' } });

    const res = await verify().expect(401);

    expect(res.body.error.code).toBe('WIDGET_TOKEN_INVALID');
    // The provider's message is written for a developer and may name internal
    // fields. It must never reach a login screen.
    expect(res.body.error.message).not.toContain('invalid token');
  });

  it('refuses a 200 that is not an explicit success', async () => {
    // The failure this guards: treating any 200 as proof. A shape change at
    // MSG91 would otherwise authenticate everyone.
    mockMsg91({ ok: true, body: { message: '919312345681' } });

    await verify().expect(401);
  });

  it('refuses a success carrying no identifier', async () => {
    mockMsg91({ ok: true, body: { type: 'success' } });

    await verify().expect(401);
  });

  it('refuses an unreadable body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>gateway error</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    await verify().expect(401);
  });

  it('returns 503, not 401, when MSG91 is unreachable', async () => {
    // A provider outage is not the user getting it wrong, and the difference
    // decides whether they retry or give up.
    mockMsg91(new Error('ECONNREFUSED'));

    const res = await verify().expect(503);
    expect(res.body.error.code).toBe('VERIFICATION_UNAVAILABLE');
  });

  it('refuses an email identifier on the phone path', async () => {
    // The widget can be configured for email. An email written into
    // phone_e164 would break every rule downstream that assumes E.164.
    mockMsg91({ ok: true, body: { type: 'success', message: 'someone@example.com' } });

    const res = await verify().expect(422);
    expect(res.body.error.code).toBe('WIDGET_IDENTIFIER_UNSUPPORTED');
  });

  it('rejects an absurdly long token before calling the provider', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');

    await verify('x'.repeat(5000)).expect(422);

    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a banned account even with a valid token', async () => {
    mockMsg91({ ok: true, body: { type: 'success', message: '919312345682' } });
    const first = await verify().expect(200);

    await pool.query("UPDATE users SET status = 'banned' WHERE id = $1", [first.body.user.id]);

    const res = await verify().expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_BANNED');
  });
});

describe('widget config', () => {
  it('is off until it is actually configured', async () => {
    // A half-filled row would send the app down a path that cannot work, and
    // it would surface as a broken login rather than a missing setting.
    await pool.query("UPDATE app_config SET value = 'true'::jsonb WHERE key = 'otp_widget_enabled'");
    await pool.query(`UPDATE app_config SET value = '""'::jsonb WHERE key = 'otp_widget_id'`);

    const res = await request(app).get('/v1/config/app').expect(200);
    expect(res.body.config.otpWidget.enabled).toBe(false);
  });

  it('is on once the switch and both values are set', async () => {
    await pool.query("UPDATE app_config SET value = 'true'::jsonb WHERE key = 'otp_widget_enabled'");
    await pool.query(`UPDATE app_config SET value = '"widget-123"'::jsonb WHERE key = 'otp_widget_id'`);
    await pool.query(
      `UPDATE app_config SET value = '"token-abc"'::jsonb WHERE key = 'otp_widget_token_auth'`,
    );

    const res = await request(app).get('/v1/config/app').expect(200);
    expect(res.body.config.otpWidget).toEqual({
      enabled: true,
      widgetId: 'widget-123',
      tokenAuth: 'token-abc',
    });
  });

  it('never serves the account authkey', async () => {
    // tokenAuth leaking costs money. The authkey leaking costs accounts.
    const res = await request(app).get('/v1/config/app').expect(200);
    expect(JSON.stringify(res.body)).not.toContain(process.env.MSG91_AUTH_KEY ?? '__unset__');
  });
});
