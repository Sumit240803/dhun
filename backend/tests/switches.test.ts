// Kill switches: one action that stops a feature on the server, in the ledger
// and in the app's config together — and the record of who threw it.

import { randomUUID } from 'crypto';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { FEATURE_KEYS, setAppVersions, setFeature } from '../src/modules/config/index.js';
import { invalidateCatalogCache } from '../src/modules/economy/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { grantWatchReward } from '../src/modules/rewards/index.js';
import { closePool, resetLedger } from './helpers.js';

vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return { ...actual, publishToRoom: () => undefined };
});

const app = buildApp();
let counter = 0;
const nextPhone = () => `+9192${String(70_000_000 + counter++).slice(-8)}`;
const nextEmail = () => `ops${counter++}.${Date.now()}@example.com`;

interface User {
  id: string;
  token: string;
}

async function registered(name = 'Asha'): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({
      phone,
      code: otp.body.devCode,
      device: { deviceId: `sw-${randomUUID()}`, platform: 'android' },
    })
    .expect(200);
  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name })
    .expect(200);
  return { id: res.body.user.id as string, token };
}

const auth = (user: User) => ({ Authorization: `Bearer ${user.token}` });

async function staff(role = 'ops_manager'): Promise<{ id: string; email: string; password: string }> {
  const email = nextEmail();
  const password = 'correct horse battery staple';
  const id = uuidv7();
  await pool.query(
    "INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, $3, 'active')",
    [id, email, await hashPassword(password)],
  );
  await pool.query("INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Ops')", [id]);
  await pool.query(
    `INSERT INTO role_assignments (id, user_id, role_code, scope_type) VALUES ($1, $2, $3, 'global')`,
    [uuidv7(), id, role],
  );
  return { id, email, password };
}

async function signIn(who: { email: string; password: string }): Promise<string> {
  const res = await request(app)
    .post('/admin/login')
    .type('form')
    .send({ email: who.email, password: who.password });
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  return cookies?.find((c) => c.startsWith('dhun_admin='))?.split(';')[0] ?? '';
}

const csrfFrom = (body: string) => /name="csrf" value="([^"]+)"/.exec(body)?.[1] ?? '';

async function featureRow(): Promise<Record<string, boolean>> {
  const { rows } = await pool.query<{ value: Record<string, boolean> }>(
    "SELECT value FROM app_config WHERE key = 'features'",
  );
  return rows[0]!.value;
}

async function txnTypeActive(code: string): Promise<boolean> {
  const { rows } = await pool.query<{ is_active: boolean }>(
    'SELECT is_active FROM ledger_txn_types WHERE code = $1',
    [code],
  );
  return rows[0]!.is_active;
}

/** Every switch back on (video off, its default), every ledger type active, the log empty. */
async function allSwitchesOn(): Promise<void> {
  const value = Object.fromEntries(FEATURE_KEYS.map((key) => [key, key !== 'videoRooms']));
  await pool.query(`UPDATE app_config SET value = $1::jsonb WHERE key = 'features'`, [
    JSON.stringify(value),
  ]);
  await pool.query(
    `UPDATE ledger_txn_types SET is_active = true
      WHERE code IN ('gift_send','purchase_iap','purchase_web','coin_to_gem_conversion',
                     'cosmetic_purchase','free_coin_grant','purchase_reseller')`,
  );
  await pool.query('TRUNCATE config_changes');
  invalidateCatalogCache();
}

beforeEach(async () => {
  await resetLedger();
  await allSwitchesOn();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
});

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await allSwitchesOn();
  await closePool();
});

const goLive = (user: User, body: Record<string, unknown> = {}) =>
  request(app)
    .post('/v1/rooms/live')
    .set(auth(user))
    .send({ title: 'Evening adda', tag: 'chatting', ...body });

describe('the switches as the app sees them', () => {
  it('arrive as client flags, with video off by default', async () => {
    const res = await request(app).get('/v1/config/app').expect(200);
    expect(res.body.config.flags).toMatchObject({
      giftingEnabled: true,
      purchasesEnabled: true,
      conversionEnabled: true,
      cosmeticsEnabled: true,
      goLiveEnabled: true,
      rewardsEnabled: true,
      agencyCoinsEnabled: true,
      videoRoomsEnabled: false,
    });
  });

  it('a feature missing from the row reads as ON — a typo cannot switch the product off', async () => {
    await pool.query(`UPDATE app_config SET value = '{}'::jsonb WHERE key = 'features'`);
    invalidateCatalogCache();
    const res = await request(app).get('/v1/config/app').expect(200);
    expect(res.body.config.flags.giftingEnabled).toBe(true);
    expect((await registered()).id).toBeTruthy();
  });
});

describe('throwing a switch', () => {
  it('stops new rooms and nothing else, and the app hears about it', async () => {
    const ops = await staff();
    const host = await registered();

    await setFeature({ key: 'goLive', enabled: false, actorId: ops.id, reason: 'LiveKit incident' });

    const refused = await goLive(host).expect(403);
    expect(refused.body.error).toMatchObject({
      code: 'FEATURE_DISABLED',
      details: { feature: 'goLive' },
    });
    await request(app).get('/v1/rooms/feed').expect(200);
    const config = await request(app).get('/v1/config/app').expect(200);
    expect(config.body.config.flags.goLiveEnabled).toBe(false);

    await setFeature({ key: 'goLive', enabled: true, actorId: ops.id, reason: 'Resolved' });
    await goLive(host).expect(201);
  });

  it('deactivates the ledger transaction type in the same write', async () => {
    const ops = await staff();
    const user = await registered();
    expect(await txnTypeActive('gift_send')).toBe(true);

    await setFeature({ key: 'gifting', enabled: false, actorId: ops.id, reason: 'Duplicate credits' });
    expect(await txnTypeActive('gift_send')).toBe(false);
    expect((await featureRow()).gifting).toBe(false);

    // Refused before any of the money gates — no Idempotency-Key is needed to
    // be told the feature is off.
    const res = await request(app)
      .post('/v1/gifts/send')
      .set(auth(user))
      .send({ roomId: randomUUID(), recipientId: randomUUID(), giftId: 'rose', quantity: 1 })
      .expect(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');

    await setFeature({ key: 'gifting', enabled: true, actorId: ops.id, reason: 'Fixed' });
    expect(await txnTypeActive('gift_send')).toBe(true);
  });

  it('free coins off: claims are refused and the gateway pays nothing', async () => {
    const ops = await staff();
    const user = await registered();
    await setFeature({ key: 'rewards', enabled: false, actorId: ops.id, reason: 'Budget breach' });

    const res = await request(app).post('/v1/rewards/checkin').set(auth(user)).expect(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
    expect(await grantWatchReward(user.id)).toBeNull();
    expect(await txnTypeActive('free_coin_grant')).toBe(false);
  });

  it('video off refuses a video room and lets an audio room start', async () => {
    const host = await registered();
    const refused = await goLive(host, { isVideo: true }).expect(403);
    expect(refused.body.error.details.feature).toBe('videoRooms');
    await goLive(host).expect(201);
  });
});

describe('the record', () => {
  it('writes who and why for every flip, and refuses a flip without a reason', async () => {
    const ops = await staff();

    await expect(
      setFeature({ key: 'pk', enabled: false, actorId: ops.id, reason: '  ' }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    expect((await featureRow()).pk).toBe(true);

    await setFeature({ key: 'pk', enabled: false, actorId: ops.id, reason: 'Scoring bug' });
    const { rows } = await pool.query(
      'SELECT key, old_value, new_value, reason, actor_user_id FROM config_changes',
    );
    expect(rows).toEqual([
      { key: 'features.pk', old_value: true, new_value: false, reason: 'Scoring bug', actor_user_id: ops.id },
    ]);
  });

  it('cannot be edited or deleted', async () => {
    const ops = await staff();
    await setFeature({ key: 'pk', enabled: false, actorId: ops.id, reason: 'Scoring bug' });
    await expect(pool.query('DELETE FROM config_changes')).rejects.toThrow(/append-only/);
    await expect(pool.query("UPDATE config_changes SET reason = 'x'")).rejects.toThrow(/append-only/);
  });
});

describe('the version floor', () => {
  it('cannot be set above the latest version, and lands in the launch config when valid', async () => {
    const ops = await staff();
    await expect(
      setAppVersions({
        minSupported: '2.0.0',
        latest: '1.5.0',
        storeUrl: '',
        actorId: ops.id,
        reason: 'Oops',
      }),
    ).rejects.toMatchObject({ code: 'VERSION_FLOOR_ABOVE_LATEST' });

    await setAppVersions({
      minSupported: '1.2.0',
      latest: '1.4.0',
      storeUrl: 'https://play.google.com/store/apps/details?id=com.dhunlive.dhun',
      actorId: ops.id,
      reason: 'Security fix in 1.2.0',
    });
    const res = await request(app).get('/v1/config/app').expect(200);
    expect(res.body.config).toMatchObject({ minSupportedVersion: '1.2.0', latestVersion: '1.4.0' });

    const { rows } = await pool.query('SELECT key FROM config_changes ORDER BY key');
    expect(rows.map((r) => r.key)).toEqual(['latest_app_version', 'min_supported_app_version']);

    // Put the floor back so no other suite's client is "too old".
    await setAppVersions({
      minSupported: '1.0.0',
      latest: '1.0.0',
      storeUrl: 'https://play.google.com/store/apps/details?id=com.dhunlive.dhun',
      actorId: ops.id,
      reason: 'Test reset',
    });
  });
});

describe('from the panel', () => {
  it('lets ops throw a switch with a reason, and shows the change', async () => {
    const cookie = await signIn(await staff('ops_manager'));
    const pageRes = await request(app).get('/admin/switches').set('Cookie', cookie).expect(200);
    expect(pageRes.text).toContain('Gifting');
    const csrf = csrfFrom(pageRes.text);

    const flipped = await request(app)
      .post('/admin/switches/feature')
      .set('Cookie', cookie)
      .type('form')
      .send({ csrf, feature: 'gifting', state: 'off', reason: 'Payment provider incident' });
    expect(flipped.headers.location).toContain('/admin/switches?ok=');
    expect((await featureRow()).gifting).toBe(false);
    expect(await txnTypeActive('gift_send')).toBe(false);

    const after = await request(app).get('/admin/switches').set('Cookie', cookie).expect(200);
    expect(after.text).toContain('Payment provider incident');
    expect(after.text).toContain('features.gifting');
  });

  it('sends a flip without a reason back to the page, unchanged', async () => {
    const cookie = await signIn(await staff('ops_manager'));
    const csrf = csrfFrom((await request(app).get('/admin/switches').set('Cookie', cookie)).text);

    const res = await request(app)
      .post('/admin/switches/feature')
      .set('Cookie', cookie)
      .type('form')
      .send({ csrf, feature: 'gifting', state: 'off', reason: '' });
    expect(res.headers.location).toContain('/admin/switches?err=');
    expect((await featureRow()).gifting).toBe(true);
  });

  it('is not for moderators', async () => {
    const cookie = await signIn(await staff('content_moderator'));
    await request(app).get('/admin/switches').set('Cookie', cookie).expect(403);
  });
});
