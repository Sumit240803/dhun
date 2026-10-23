// The reports queue in the admin panel: what users flagged, and what a
// moderator's decision does to it.

import { randomUUID } from 'crypto';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { closePool, resetLedger } from './helpers.js';

vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return { ...actual, publishToRoom: () => undefined };
});

const app = buildApp();
let counter = 0;
const nextPhone = () => `+9191${String(80_000_000 + counter++).slice(-8)}`;
const nextEmail = () => `mod${counter++}.${Date.now()}@example.com`;

interface User {
  id: string;
  token: string;
}

async function registered(name: string): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({
      phone,
      code: otp.body.devCode,
      device: { deviceId: `rq-${randomUUID()}`, platform: 'android' },
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

async function report(
  by: User,
  subject: { subjectType: 'user' | 'room'; subjectId: string },
  reason = 'harassment',
  detail?: string,
): Promise<string> {
  await request(app)
    .post('/v1/moderation/reports')
    .set(auth(by))
    .send({ ...subject, reason, ...(detail ? { detail } : {}) })
    .expect(202);
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM reports WHERE reporter_user_id = $1 AND subject_id = $2',
    [by.id, subject.subjectId],
  );
  return rows[0]!.id;
}

async function staff(role = 'ts_lead'): Promise<{ email: string; password: string }> {
  const email = nextEmail();
  const password = 'correct horse battery staple';
  const id = uuidv7();
  await pool.query(
    "INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, $3, 'active')",
    [id, email, await hashPassword(password)],
  );
  await pool.query("INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Mod')", [id]);
  await pool.query(
    `INSERT INTO role_assignments (id, user_id, role_code, scope_type) VALUES ($1, $2, $3, 'global')`,
    [uuidv7(), id, role],
  );
  return { email, password };
}

async function signIn(who: { email: string; password: string }): Promise<string> {
  const res = await request(app).post('/admin/login').type('form').send(who);
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  return cookies?.find((c) => c.startsWith('dhun_admin='))?.split(';')[0] ?? '';
}

async function panel(role?: string): Promise<{ cookie: string; csrf: string }> {
  const cookie = await signIn(await staff(role));
  const pageRes = await request(app).get('/admin/reports').set('Cookie', cookie).expect(200);
  return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(pageRes.text)?.[1] ?? '' };
}

function decide(
  session: { cookie: string; csrf: string },
  reportId: string,
  decision: string,
  note = '',
) {
  return request(app)
    .post('/admin/reports/decide')
    .set('Cookie', session.cookie)
    .type('form')
    .send({ csrf: session.csrf, reportId, decision, note });
}

async function status(reportId: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>('SELECT status FROM reports WHERE id = $1', [
    reportId,
  ]);
  return rows[0]!.status;
}

beforeEach(async () => {
  await resetLedger();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());
afterAll(closePool);

describe('the reports queue', () => {
  it('shows who was reported, by whom, and why — with the badge on the tab', async () => {
    const asha = await registered('Asha');
    const rude = await registered('Rude Person');
    await report(asha, { subjectType: 'user', subjectId: rude.id }, 'harassment', 'Kept messaging after I said stop');

    const { cookie } = await panel();
    const res = await request(app).get('/admin/reports').set('Cookie', cookie).expect(200);
    expect(res.text).toContain('Harassment or bullying');
    expect(res.text).toContain('Rude Person');
    expect(res.text).toContain('Kept messaging after I said stop');
    expect(res.text).toContain(`/admin/users/${rude.id}`);
    // The reports tab carries its own count.
    expect(res.text).toMatch(/Reports<span class="badge">1<\/span>/);
  });

  it('a flag closes every open report about the person and logs where it came from', async () => {
    const [a, b, target] = await Promise.all([registered('Asha'), registered('Bela'), registered('Target')]);
    const first = await report(a, { subjectType: 'user', subjectId: target.id });
    const second = await report(b, { subjectType: 'user', subjectId: target.id }, 'spam');

    const session = await panel();
    const res = await decide(session, first, 'flag', 'Two reports in an hour');
    expect(decodeURIComponent(res.headers.location)).toContain('2 reports closed');

    expect(await status(first)).toBe('actioned');
    expect(await status(second)).toBe('actioned');
    const { rows: users } = await pool.query('SELECT host_flagged_at FROM users WHERE id = $1', [target.id]);
    expect(users[0].host_flagged_at).not.toBeNull();
    const { rows: log } = await pool.query(
      'SELECT action, source, source_id, note FROM enforcement_actions WHERE subject_id = $1',
      [target.id],
    );
    expect(log).toEqual([{ action: 'flag', source: 'report', source_id: first, note: 'Two reports in an hour' }]);
  });

  it('a dismissal closes only the report in hand', async () => {
    const [a, b, target] = await Promise.all([registered('Asha'), registered('Bela'), registered('Target')]);
    const first = await report(a, { subjectType: 'user', subjectId: target.id });
    const second = await report(b, { subjectType: 'user', subjectId: target.id }, 'spam');

    const session = await panel();
    await decide(session, first, 'dismiss').expect(302);
    expect(await status(first)).toBe('dismissed');
    expect(await status(second)).toBe('open');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM enforcement_actions');
    expect(rows[0].n).toBe(0);
  });

  it('a moderator may flag and not suspend; a decided report cannot be decided twice', async () => {
    const [a, target] = await Promise.all([registered('Asha'), registered('Target')]);
    const id = await report(a, { subjectType: 'user', subjectId: target.id });

    const moderator = await panel('content_moderator');
    await decide(moderator, id, 'suspend').expect(403);
    expect(await status(id)).toBe('open');

    await decide(moderator, id, 'flag').expect(302);
    expect(await status(id)).toBe('actioned');
    await decide(moderator, id, 'flag').expect(404);
  });

  it('a report about a live room can end it, and shows it as live first', async () => {
    const [viewer, host] = await Promise.all([registered('Viewer'), registered('Host')]);
    const room = await request(app)
      .post('/v1/rooms/live')
      .set(auth(host))
      .send({ title: 'Late night', tag: 'chatting' })
      .expect(201);
    const roomId = room.body.room.id as string;
    const id = await report(viewer, { subjectType: 'room', subjectId: roomId }, 'nudity');

    const session = await panel();
    const pageRes = await request(app).get('/admin/reports').set('Cookie', session.cookie).expect(200);
    expect(pageRes.text).toContain('live now');
    expect(pageRes.text).toContain('value="end_room"');

    await decide(session, id, 'end_room').expect(302);
    const { rows } = await pool.query('SELECT ended_at, ended_reason FROM rooms WHERE id = $1', [roomId]);
    expect(rows[0].ended_at).not.toBeNull();
    expect(rows[0].ended_reason).toBe('moderation');
    expect(await status(id)).toBe('actioned');
  });
});
