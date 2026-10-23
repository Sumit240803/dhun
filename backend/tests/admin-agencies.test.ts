// The agency back office in the panel: create, grant trading, record and
// confirm a prepay under maker-checker, suspend with a reason.

import { randomUUID } from 'crypto';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { invalidateCatalogCache } from '../src/modules/economy/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { closePool, resetLedger, sumEntries } from './helpers.js';

vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return { ...actual, publishToRoom: () => undefined };
});

const app = buildApp();
let counter = 0;
const nextPhone = () => `+9189${String(10_000_000 + counter++).slice(-8)}`;
const nextEmail = () => `agops${counter++}.${Date.now()}@example.com`;

async function registered(name: string): Promise<{ id: string; publicId: number }> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { deviceId: `aa-${randomUUID()}`, platform: 'android' } })
    .expect(200);
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${res.body.accessToken}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name })
    .expect(200);
  const { rows } = await pool.query('SELECT public_id FROM users WHERE id = $1', [res.body.user.id]);
  return { id: res.body.user.id as string, publicId: Number(rows[0].public_id) };
}

async function staff(role = 'ops_manager'): Promise<{ id: string; email: string; password: string }> {
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
  return { id, email, password };
}

async function panel(who?: { email: string; password: string }): Promise<{ cookie: string; csrf: string }> {
  const res = await request(app).post('/admin/login').type('form').send(who ?? (await staff()));
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith('dhun_admin='))?.split(';')[0] ?? '';
  const pageRes = await request(app).get('/admin/agencies').set('Cookie', cookie).expect(200);
  return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(pageRes.text)?.[1] ?? '' };
}

const post = (s: { cookie: string; csrf: string }, path: string, body: Record<string, string>) =>
  request(app).post(path).set('Cookie', s.cookie).type('form').send({ csrf: s.csrf, ...body });

async function agencyRow(name: string): Promise<{ id: string; public_id: string }> {
  const { rows } = await pool.query('SELECT id, public_id FROM agencies WHERE name = $1', [name]);
  return rows[0]!;
}

beforeEach(async () => {
  await resetLedger();
  invalidateCatalogCache();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());
afterAll(closePool);

describe('the agency pages', () => {
  it('create an agency for a user and show it in the list', async () => {
    const owner = await registered('Meera Owner');
    const s = await panel();

    const created = await post(s, '/admin/agencies/create', {
      ownerUserId: String(owner.publicId),
      name: 'Sur Talent',
      contactEmail: 'hello@surtalent.in',
    });
    const agency = await agencyRow('Sur Talent');
    expect(created.headers.location).toBe(`/admin/agencies/${agency.id}?ok=Agency%20created.`);

    const list = await request(app).get('/admin/agencies').set('Cookie', s.cookie).expect(200);
    expect(list.text).toContain('Sur Talent');
    expect(list.text).toContain('Meera Owner');
    expect(list.text).toContain('no coin trading'.replace('no coin trading', '>no<'));

    const detail = await request(app).get(`/admin/agencies/${agency.id}`).set('Cookie', s.cookie).expect(200);
    expect(detail.text).toContain('hello@surtalent.in');
    expect(detail.text).toContain('Grant coin trading');
  });

  it('refuse a bad owner ID with a banner, not a stack trace', async () => {
    const s = await panel();
    const res = await post(s, '/admin/agencies/create', { ownerUserId: '99999999', name: 'Ghost' });
    expect(decodeURIComponent(res.headers.location)).toContain('/admin/agencies?err=No registered user');
  });

  it('mint inventory only when a DIFFERENT person confirms the prepay', async () => {
    const owner = await registered('Owner');
    const maker = await panel();
    await post(maker, '/admin/agencies/create', { ownerUserId: String(owner.publicId), name: 'Dhun Stars' });
    const agency = await agencyRow('Dhun Stars');

    await post(maker, `/admin/agencies/${agency.id}/coin-trading`, { enabled: 'on' }).expect(302);

    const recorded = await post(maker, '/admin/agencies/prepay', {
      agencyId: String(agency.public_id),
      rupees: '1,00,000',
      method: 'upi',
      paymentReference: 'UTR-2026-0001',
    });
    expect(decodeURIComponent(recorded.headers.location)).toContain('Someone else confirms it');
    expect(await sumEntries('agency_inventory', agency.id)).toBe(0);

    const { rows } = await pool.query<{ id: string }>('SELECT id FROM agency_prepays WHERE agency_id = $1', [
      agency.id,
    ]);
    const prepayId = rows[0]!.id;

    // The maker trying to be the checker: the database refuses, the page says so.
    const own = await post(maker, `/admin/agencies/prepay/${prepayId}/confirm`, {});
    expect(own.headers.location).toContain('/admin/agencies?err=');
    expect(await sumEntries('agency_inventory', agency.id)).toBe(0);

    const checker = await panel();
    const confirmed = await post(checker, `/admin/agencies/prepay/${prepayId}/confirm`, {});
    expect(decodeURIComponent(confirmed.headers.location)).toContain('coins minted for Dhun Stars');
    // ₹1,00,000 at the 132/₹ tier.
    expect(await sumEntries('agency_inventory', agency.id)).toBe(13_200_000);

    const page = await request(app).get(`/admin/agencies/${agency.id}`).set('Cookie', checker.cookie).expect(200);
    expect(page.text).toContain('confirmed');
    expect(page.text).toContain('1,32,00,000');
  });

  it('suspend with a reason, and show the reason', async () => {
    const owner = await registered('Owner');
    const s = await panel();
    await post(s, '/admin/agencies/create', { ownerUserId: String(owner.publicId), name: 'Pause Me' });
    const agency = await agencyRow('Pause Me');

    const noReason = await post(s, `/admin/agencies/${agency.id}/status`, { status: 'suspended', reason: '' });
    expect(noReason.headers.location).toContain('err=');

    await post(s, `/admin/agencies/${agency.id}/status`, {
      status: 'suspended',
      reason: 'Selling below the floor',
    }).expect(302);
    const page = await request(app).get(`/admin/agencies/${agency.id}`).set('Cookie', s.cookie).expect(200);
    expect(page.text).toContain('Suspended: Selling below the floor');
    expect(page.text).toContain('Reinstate');
  });

  it('is not for moderators', async () => {
    const mod = await staff('content_moderator');
    const res = await request(app).post('/admin/login').type('form').send(mod);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('dhun_admin='))!.split(';')[0];
    await request(app).get('/admin/agencies').set('Cookie', cookie).expect(403);
  });
});
