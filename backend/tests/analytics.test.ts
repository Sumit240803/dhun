// The analytics sink (migration 039, build-plan M21 slice 5): what the app may
// tell us, what it may not, and where the money numbers really come from.

import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'zlib';

const archived: { key: string; body: Buffer }[] = [];
let archiveOn = false;
vi.mock('../src/modules/media/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/modules/media/index.js')>();
  return {
    ...real,
    isArchiveConfigured: () => archiveOn,
    putArchiveObject: async (o: { key: string; body: Buffer }) => {
      archived.push({ key: o.key, body: o.body });
    },
  };
});

import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { funnel, recordAnalytics } from '../src/modules/telemetry/index.js';
import { analyticsExportJob, analyticsPartitionsJob, exportDay } from '../src/workers/jobs/analytics.js';
import { runJobOnce } from '../src/workers/scheduler.js';
import { closePool, createUser, resetLedger } from './helpers.js';

const app = buildApp();
const DEVICE = 'device-analytics-0001';
const PASSWORD = 'correct horse battery staple';
let counter = 0;

const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const istYesterday = () => new Date(Date.now() + 5.5 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
/** Noon IST on a day, as an ISO instant. */
const noonIst = (day: string) => new Date(`${day}T06:30:00.000Z`).toISOString();

const batch = (events: unknown[], extra: Record<string, unknown> = {}) => ({
  app: { version: '1.0.0', platform: 'android', update: 'embedded' },
  deviceId: DEVICE,
  events,
  ...extra,
});

async function signedIn(): Promise<{ id: string; token: string }> {
  const email = `analytics${counter++}.${Date.now()}@example.com`;
  const res = await request(app)
    .post('/v1/auth/email/register')
    .send({ email, password: PASSWORD, device: { deviceId: `an-${uuidv7()}`, platform: 'android' } })
    .expect(201);
  return { id: res.body.user.id, token: res.body.accessToken };
}

async function staffCookie(role: string): Promise<string> {
  const email = `staff-an${counter++}.${Date.now()}@example.com`;
  const id = uuidv7();
  await pool.query("INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, $3, 'active')", [
    id,
    email,
    await hashPassword(PASSWORD),
  ]);
  await pool.query("INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Ops')", [id]);
  await pool.query(
    `INSERT INTO role_assignments (id, user_id, role_code, scope_type) VALUES ($1, $2, $3, 'global')`,
    [uuidv7(), id, role],
  );
  const res = await request(app).post('/admin/login').type('form').send({ email, password: PASSWORD });
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  return cookies?.find((c) => c.startsWith('dhun_admin='))?.split(';')[0] ?? '';
}

const silence = () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
};

beforeEach(async () => {
  await resetLedger();
  archived.length = 0;
  archiveOn = false;
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await closePool();
});

describe('the endpoint', () => {
  it('stores a batch; the account comes from the token, never the body', async () => {
    silence();
    const user = await signedIn();
    await request(app)
      .post('/v1/client/analytics')
      .set('Authorization', `Bearer ${user.token}`)
      .send(
        batch([
          { event: 'app_opened', occurredAt: new Date().toISOString(), sessionId: 's-1' },
          { event: 'gift_sent', props: { gift_id: 'rose', quantity: 10, password: 'hunter2' } },
        ]),
      )
      .expect(202, { accepted: 2 });

    const { rows } = await pool.query(
      'SELECT event, user_id, device_id, session_id, platform, app_update, props FROM analytics_events ORDER BY event',
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.user_id === user.id && r.device_id === DEVICE)).toBe(true);
    expect(rows[0]).toMatchObject({ event: 'app_opened', session_id: 's-1', platform: 'android', app_update: 'embedded' });
    expect(rows[1].props).toEqual({ gift_id: 'rose', quantity: 10, password: '[redacted]' });
  });

  it('a guest is stored with no account', async () => {
    await request(app).post('/v1/client/analytics').send(batch([{ event: 'app_opened' }])).expect(202);
    const { rows } = await pool.query('SELECT user_id, device_id FROM analytics_events');
    expect(rows).toEqual([{ user_id: null, device_id: DEVICE }]);
  });

  it("replaces a clock it cannot believe with the server's", async () => {
    await request(app)
      .post('/v1/client/analytics')
      .send(batch([{ event: 'app_opened', occurredAt: '2099-01-01T00:00:00Z' }, { event: 'feed_viewed', occurredAt: '2020-01-01T00:00:00Z' }]))
      .expect(202);
    const { rows } = await pool.query<{ occurred_at: Date }>('SELECT occurred_at FROM analytics_events');
    for (const r of rows) expect(Math.abs(r.occurred_at.getTime() - Date.now())).toBeLessThan(60_000);
    // Neither landed in the default partition: today's exists.
    const stray = await pool.query('SELECT count(*)::int AS n FROM analytics_events_default');
    expect(stray.rows[0].n).toBe(0);
  });

  it('refuses what it does not understand', async () => {
    silence();
    const post = (body: unknown) => request(app).post('/v1/client/analytics').send(body as object);
    await post(batch([{ event: 'App Opened' }])).expect(422);
    await post(batch([{ event: 'app_opened', userId: 'someone-else' }])).expect(422);
    await post(batch([{ event: 'app_opened', props: { nested: { a: 1 } } }])).expect(422);
    await post(batch([])).expect(422);
    await post(batch(Array.from({ length: 51 }, () => ({ event: 'app_opened' })))).expect(422);
    await post(batch([{ event: 'app_opened' }], { userId: 'forged' })).expect(422);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM analytics_events');
    expect(rows[0].n).toBe(0);
  });
});

describe('the funnel', () => {
  it('counts the early steps from app events and the money steps from the ledger tables', async () => {
    const day = istYesterday();
    const at = noonIst(day);
    await recordAnalytics({
      userId: null,
      deviceId: 'dev-a',
      app: { version: '1', platform: 'android' },
      events: [
        { event: 'app_opened', occurredAt: at },
        { event: 'room_card_tapped', occurredAt: at },
      ],
    });
    await recordAnalytics({
      userId: null,
      deviceId: 'dev-b',
      app: { version: '1', platform: 'android' },
      // A forged purchase event from a tampered client: counted nowhere.
      events: [{ event: 'app_opened', occurredAt: at }, { event: 'purchase_completed', occurredAt: at }],
    });

    const payer = await createUser('active');
    const pack = (await pool.query<{ id: string }>('SELECT id FROM coin_packs ORDER BY price_paise LIMIT 1')).rows[0].id;
    await pool.query(
      `INSERT INTO purchases (id, user_id, pack_id, channel, provider, provider_txn_id, amount_paise,
                              coins_granted, gems_granted, status, credited_at)
       VALUES ($1, $2, $3, 'iap', 'google_play', $4, 9900, 10890, 2610, 'credited', $5)`,
      [uuidv7(), payer, pack, `t-${uuidv7()}`, at],
    );

    const f = await funnel(day);
    expect(f.day).toBe(day);
    expect(f.steps.map((s) => [s.name, s.people])).toEqual([
      ['opened the app', 2],
      ['signed up', 0],
      ['opened a room', 1],
      ['first purchase', 1],
      ['first gift', 0],
    ]);
  });
});

describe('the jobs', () => {
  it('keeps partitions a week ahead', async () => {
    await runJobOnce(analyticsPartitionsJob);
    const { rows } = await pool.query(
      "SELECT result FROM job_runs WHERE job = 'analytics_partitions' ORDER BY id DESC LIMIT 1",
    );
    expect(rows[0].result).toMatchObject({ dropped: 0, inDefault: 0 });
    const ahead = new Date(Date.now() + 5.5 * 3_600_000 + 7 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
    const exists = await pool.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`analytics_events_${ahead}`]);
    expect(exists.rows[0].ok).toBe(true);
  });

  it('exports a day as gzipped NDJSON, and skips cleanly without a private bucket', async () => {
    const day = istToday();
    await recordAnalytics({
      userId: null,
      deviceId: 'dev-x',
      app: { version: '1', platform: 'ios' },
      events: [{ event: 'app_opened' }, { event: 'feed_viewed' }],
    });

    await runJobOnce(analyticsExportJob);
    expect(archived).toHaveLength(0);

    archiveOn = true;
    const out = await exportDay(day);
    expect(out.rows).toBe(2);
    expect(out.key).toBe(`analytics/${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8)}.ndjson.gz`);
    const lines = gunzipSync(archived[0].body).toString().trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.event).sort()).toEqual(['app_opened', 'feed_viewed']);
    expect(lines[0].device_id).toBe('dev-x');
  });
});

describe('the Metrics screen', () => {
  it('shows the funnel and money to ops, and nothing to a moderator', async () => {
    silence();
    const ops = await staffCookie('ops_manager');
    const page = await request(app).get('/admin/metrics').set('Cookie', ops).expect(200);
    expect(page.text).toContain('from app opened to first gift');
    expect(page.text).toContain('first purchase');
    expect(page.text).toContain('Coins per room hour');

    const mod = await staffCookie('content_moderator');
    await request(app).get('/admin/metrics').set('Cookie', mod).expect(403);
  });
});
