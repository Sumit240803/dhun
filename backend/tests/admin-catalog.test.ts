// The catalog page: a price change reaches the app's catalog without a release,
// is recorded with a reason, and a dial the service could not parse is refused.

import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { invalidateCatalogCache, listCoinPacks } from '../src/modules/economy/index.js';
import { freeCoinsConfig } from '../src/modules/rewards/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();
let counter = 0;
const nextEmail = () => `cat${counter++}.${Date.now()}@example.com`;

async function staff(role = 'ops_manager'): Promise<{ email: string; password: string }> {
  const email = nextEmail();
  const password = 'correct horse battery staple';
  const id = uuidv7();
  await pool.query("INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, $3, 'active')", [
    id,
    email,
    await hashPassword(password),
  ]);
  await pool.query("INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Ops')", [id]);
  await pool.query(
    `INSERT INTO role_assignments (id, user_id, role_code, scope_type) VALUES ($1, $2, $3, 'global')`,
    [uuidv7(), id, role],
  );
  return { email, password };
}

async function panel(role?: string): Promise<{ cookie: string; csrf: string }> {
  const res = await request(app).post('/admin/login').type('form').send(await staff(role));
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith('dhun_admin='))?.split(';')[0] ?? '';
  const pageRes = await request(app).get('/admin/catalog').set('Cookie', cookie);
  return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(pageRes.text)?.[1] ?? '' };
}

const post = (s: { cookie: string; csrf: string }, path: string, body: Record<string, string>) =>
  request(app).post(path).set('Cookie', s.cookie).type('form').send({ csrf: s.csrf, ...body });

/** What the seed says, so a test can put it back. */
let roseBefore: { coin_price: string; payout_rate_bp: number };
let freeCoinsBefore: unknown;
let starterBefore: { price_paise: string; coins: string; gems: string; is_active: boolean };

beforeEach(async () => {
  await resetLedger();
  invalidateCatalogCache();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
  roseBefore = (await pool.query("SELECT coin_price, payout_rate_bp FROM gift_catalog WHERE id = 'rose'")).rows[0];
  freeCoinsBefore = (await pool.query("SELECT value FROM app_config WHERE key = 'free_coins'")).rows[0].value;
  starterBefore = (await pool.query("SELECT price_paise, coins, gems, is_active FROM coin_packs WHERE id = 'starter_19'")).rows[0];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await pool.query("UPDATE gift_catalog SET coin_price = $1, payout_rate_bp = $2, is_active = true WHERE id = 'rose'", [
    roseBefore.coin_price,
    roseBefore.payout_rate_bp,
  ]);
  await pool.query("UPDATE coin_packs SET price_paise = $1, coins = $2, gems = $3, is_active = $4 WHERE id = 'starter_19'", [
    starterBefore.price_paise,
    starterBefore.coins,
    starterBefore.gems,
    starterBefore.is_active,
  ]);
  await pool.query("UPDATE app_config SET value = $1::jsonb WHERE key = 'free_coins'", [JSON.stringify(freeCoinsBefore)]);
  invalidateCatalogCache();
});
afterAll(closePool);

describe('the catalog page', () => {
  it('shows every gift and pack, including ones switched off', async () => {
    await pool.query("UPDATE gift_catalog SET is_active = false WHERE id = 'rose'");
    const s = await panel();
    const res = await request(app).get('/admin/catalog').set('Cookie', s.cookie).expect(200);
    expect(res.text).toContain('Rose');
    expect(res.text).toContain('Starter');
    expect(res.text).toContain('Check-in ladder');
  });

  it('a price change reaches the app’s catalog at once, with who and why on record', async () => {
    const s = await panel();
    const before = await request(app).get('/v1/catalog/gifts').expect(200);
    const rose = before.body.gifts.find((g: { id: string }) => g.id === 'rose');
    expect(rose.coinPrice).toBe(Number(roseBefore.coin_price));

    const saved = await post(s, '/admin/catalog/gift', {
      id: 'rose',
      coinPrice: '100',
      payoutRateBp: '7000',
      isActive: 'on',
      reason: 'Diwali week: roses pay 70%',
    });
    expect(saved.headers.location).toContain('/admin/catalog?ok=');

    const after = await request(app).get('/v1/catalog/gifts').expect(200);
    expect(after.body.gifts.find((g: { id: string }) => g.id === 'rose')).toMatchObject({
      coinPrice: 100,
      payoutRateBp: 7000,
    });
    const { rows } = await pool.query("SELECT old_value, new_value, reason FROM config_changes WHERE key = 'gift.rose'");
    expect(rows[0]).toMatchObject({
      old_value: { coinPrice: Number(roseBefore.coin_price), payoutRateBp: roseBefore.payout_rate_bp, isActive: true },
      new_value: { coinPrice: 100, payoutRateBp: 7000, isActive: true },
      reason: 'Diwali week: roses pay 70%',
    });
  });

  it('refuses a save with nothing changed, no reason, or an impossible number', async () => {
    const s = await panel();
    const same = await post(s, '/admin/catalog/gift', {
      id: 'rose',
      coinPrice: roseBefore.coin_price,
      payoutRateBp: String(roseBefore.payout_rate_bp),
      isActive: 'on',
      reason: 'No-op',
    });
    expect(decodeURIComponent(same.headers.location)).toContain('err=Nothing changed');

    const noReason = await post(s, '/admin/catalog/gift', { id: 'rose', coinPrice: '100', payoutRateBp: '6000', isActive: 'on', reason: '' });
    expect(noReason.headers.location).toContain('err=');

    const tooMuch = await post(s, '/admin/catalog/gift', { id: 'rose', coinPrice: '100', payoutRateBp: '12000', isActive: 'on', reason: 'Oops' });
    expect(decodeURIComponent(tooMuch.headers.location)).toContain('payoutRateBp');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM config_changes');
    expect(rows[0].n).toBe(0);
  });

  it('switching a pack off hides it from the app; the price is taken in rupees', async () => {
    const s = await panel();
    await post(s, '/admin/catalog/pack', {
      id: 'starter_19',
      rupees: '19',
      coins: starterBefore.coins,
      gems: starterBefore.gems,
      // isActive omitted: the checkbox is unticked.
      reason: 'Starter paused while Play billing is sorted',
    }).expect(302);

    // The same cached list the wallet endpoint serves; the cache was cleared by the save.
    const packs = await listCoinPacks();
    expect(packs.some((p) => p.id === 'starter_19')).toBe(false);
    const { rows } = await pool.query("SELECT is_active, price_paise FROM coin_packs WHERE id = 'starter_19'");
    expect(rows[0]).toMatchObject({ is_active: false, price_paise: '1900' });
  });

  it('a dial is saved only when the service would parse it, and the service sees it', async () => {
    const s = await panel();
    const base = {
      signup: '1000',
      watchCoins: '60',
      watchMinutes: '5',
      watchDailyCap: '10',
      referralCoins: '4000',
      referralMinRupees: '99',
      referralAttachWindowDays: '7',
      reason: 'Budget retune',
    };

    const short = await post(s, '/admin/catalog/dial/free_coins', { ...base, checkinLadder: '40, 60, 80' });
    expect(decodeURIComponent(short.headers.location)).toContain('checkinLadder');

    await post(s, '/admin/catalog/dial/free_coins', { ...base, checkinLadder: '50, 60, 80, 120, 160, 200, 300' }).expect(302);
    const cfg = await freeCoinsConfig();
    expect(cfg.checkinLadder).toEqual([50, 60, 80, 120, 160, 200, 300]);
    expect(cfg.referral.minPurchasePaise).toBe(9900);

    const { rows } = await pool.query("SELECT key, reason FROM config_changes WHERE key = 'free_coins'");
    expect(rows).toEqual([{ key: 'free_coins', reason: 'Budget retune' }]);
  });

  it('is not for moderators', async () => {
    const s = await panel('content_moderator');
    await request(app).get('/admin/catalog').set('Cookie', s.cookie).expect(403);
  });
});
