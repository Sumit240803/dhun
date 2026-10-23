// Appeals: a suspended host is heard by somebody other than the person who
// suspended them, and the outcome goes through the same log as everything else.

import { randomUUID } from 'crypto';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { enforce } from '../src/modules/verification/index.js';
import { closePool, resetLedger } from './helpers.js';

vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return { ...actual, publishToRoom: () => undefined };
});

const app = buildApp();
let counter = 0;
const nextPhone = () => `+9190${String(90_000_000 + counter++).slice(-8)}`;
const nextEmail = () => `lead${counter++}.${Date.now()}@example.com`;

interface User {
  id: string;
  token: string;
}

async function registered(name = 'Meera'): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({
      phone,
      code: otp.body.devCode,
      device: { deviceId: `ap-${randomUUID()}`, platform: 'android' },
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

async function staff(role = 'ts_lead'): Promise<{ id: string; email: string; password: string }> {
  const email = nextEmail();
  const password = 'correct horse battery staple';
  const id = uuidv7();
  await pool.query(
    "INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, $3, 'active')",
    [id, email, await hashPassword(password)],
  );
  await pool.query("INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Lead')", [id]);
  await pool.query(
    `INSERT INTO role_assignments (id, user_id, role_code, scope_type) VALUES ($1, $2, $3, 'global')`,
    [uuidv7(), id, role],
  );
  return { id, email, password };
}

async function panel(who: { email: string; password: string }): Promise<{ cookie: string; csrf: string }> {
  const res = await request(app).post('/admin/login').type('form').send(who);
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith('dhun_admin='))?.split(';')[0] ?? '';
  const pageRes = await request(app).get('/admin/queue').set('Cookie', cookie).expect(200);
  return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(pageRes.text)?.[1] ?? '' };
}

async function suspend(host: User, by: { id: string }, note = 'Face check mismatch') {
  await enforce({
    actorId: by.id,
    action: 'suspend',
    subjectType: 'user',
    subjectId: host.id,
    source: 'manual',
    note,
  });
}

const APPEAL = 'That was my sister using my phone while I was travelling. It will not happen again.';

async function appealId(host: User): Promise<string> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM appeals WHERE user_id = $1', [host.id]);
  return rows[0]!.id;
}

beforeEach(async () => {
  await resetLedger();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());
afterAll(closePool);

describe('filing an appeal', () => {
  it('tells a suspended host they are suspended, and takes one appeal per suspension', async () => {
    const host = await registered();
    const lead = await staff();
    await suspend(host, lead);

    const before = await request(app).get('/v1/appeals/me').set(auth(host)).expect(200);
    expect(before.body.appeal).toMatchObject({ suspended: true, appeal: null });
    expect(before.body.appeal.suspendedAt).toBeTruthy();

    const short = await request(app).post('/v1/appeals').set(auth(host)).send({ message: 'Not me' }).expect(422);
    expect(short.body.error.code).toBe('VALIDATION_FAILED');

    const filed = await request(app).post('/v1/appeals').set(auth(host)).send({ message: APPEAL }).expect(201);
    expect(filed.body.appeal.appeal).toMatchObject({ status: 'open', message: APPEAL });

    const again = await request(app).post('/v1/appeals').set(auth(host)).send({ message: APPEAL }).expect(409);
    expect(again.body.error.code).toBe('APPEAL_PENDING');
  });

  it('is not for a host who is not suspended', async () => {
    const host = await registered();
    const res = await request(app).post('/v1/appeals').set(auth(host)).send({ message: APPEAL }).expect(409);
    expect(res.body.error.code).toBe('NOT_SUSPENDED');
  });
});

describe('deciding an appeal', () => {
  it('refuses the person who suspended the host, and lets a different lead lift it', async () => {
    const host = await registered();
    const suspender = await staff();
    const other = await staff();
    await suspend(host, suspender);
    await request(app).post('/v1/appeals').set(auth(host)).send({ message: APPEAL }).expect(201);
    const id = await appealId(host);

    // The suspending lead sees the appeal with no form, and is refused if they post anyway.
    const own = await panel(suspender);
    const ownPage = await request(app).get('/admin/queue').set('Cookie', own.cookie).expect(200);
    expect(ownPage.text).toContain('for someone else to decide');
    const refused = await request(app)
      .post('/admin/queue/appeal')
      .set('Cookie', own.cookie)
      .type('form')
      .send({ csrf: own.csrf, appealId: id, decision: 'overturned', note: '' });
    expect(refused.headers.location).toContain('/admin/queue?err=');
    const { rows: still } = await pool.query('SELECT host_suspended_at FROM users WHERE id = $1', [host.id]);
    expect(still[0].host_suspended_at).not.toBeNull();

    const second = await panel(other);
    const lifted = await request(app)
      .post('/admin/queue/appeal')
      .set('Cookie', second.cookie)
      .type('form')
      .send({ csrf: second.csrf, appealId: id, decision: 'overturned', note: 'Checked the frames, different lighting' });
    expect(lifted.headers.location).toContain('/admin/queue?ok=');

    const { rows: users } = await pool.query('SELECT host_suspended_at FROM users WHERE id = $1', [host.id]);
    expect(users[0].host_suspended_at).toBeNull();
    const { rows: log } = await pool.query(
      `SELECT action, source, source_id, actor_id FROM enforcement_actions
        WHERE subject_id = $1 ORDER BY created_at`,
      [host.id],
    );
    expect(log).toEqual([
      expect.objectContaining({ action: 'suspend', source: 'manual', actor_id: suspender.id }),
      { action: 'unsuspend', source: 'appeal', source_id: id, actor_id: other.id },
    ]);

    const after = await request(app).get('/v1/appeals/me').set(auth(host)).expect(200);
    expect(after.body.appeal.suspended).toBe(false);
    expect(after.body.appeal.appeal).toMatchObject({
      status: 'overturned',
      note: 'Checked the frames, different lighting',
    });
    // They can go live again.
    await request(app)
      .post('/v1/rooms/live')
      .set(auth(host))
      .send({ title: 'Back', tag: 'chatting' })
      .expect(201);
  });

  it('upholding keeps the suspension, shows the note, and a later suspension can be appealed anew', async () => {
    const host = await registered();
    const suspender = await staff();
    const lead = await staff();
    await suspend(host, suspender);
    await request(app).post('/v1/appeals').set(auth(host)).send({ message: APPEAL }).expect(201);

    const session = await panel(lead);
    await request(app)
      .post('/admin/queue/appeal')
      .set('Cookie', session.cookie)
      .type('form')
      .send({ csrf: session.csrf, appealId: await appealId(host), decision: 'upheld', note: 'The frames match' })
      .expect(302);

    const me = await request(app).get('/v1/appeals/me').set(auth(host)).expect(200);
    expect(me.body.appeal).toMatchObject({ suspended: true, appeal: { status: 'upheld', note: 'The frames match' } });
    const decided = await request(app).post('/v1/appeals').set(auth(host)).send({ message: APPEAL }).expect(409);
    expect(decided.body.error.code).toBe('APPEAL_DECIDED');

    // Lifted by hand, suspended again later: a new decision, a new appeal.
    await enforce({ actorId: lead.id, action: 'unsuspend', subjectType: 'user', subjectId: host.id, source: 'manual' });
    await suspend(host, lead, 'Second incident');
    await request(app).post('/v1/appeals').set(auth(host)).send({ message: APPEAL }).expect(201);
  });

  it('is a lead’s call, not a moderator’s', async () => {
    const host = await registered();
    await suspend(host, await staff());
    await request(app).post('/v1/appeals').set(auth(host)).send({ message: APPEAL }).expect(201);

    const moderator = await panel(await staff('content_moderator'));
    await request(app)
      .post('/admin/queue/appeal')
      .set('Cookie', moderator.cookie)
      .type('form')
      .send({ csrf: moderator.csrf, appealId: await appealId(host), decision: 'overturned' })
      .expect(403);
  });
});
