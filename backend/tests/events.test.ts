// The event log (migration 038): what gets kept, what never does, and who sees it.
//
// The properties that matter, in the order the tests check them: a row never
// carries a secret however it was passed; every logger.error from anywhere is
// a row; a 5xx is a row with its trace id; the audit actions are rows; the app
// can report its own errors; the screen is ops-only; and the jobs age rows out
// and notice a burst.

import express from 'express';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { setAlertTransport, type Alert } from '../src/infra/alerts.js';
import { runWithContext } from '../src/infra/context.js';
import { pool } from '../src/infra/db.js';
import {
  discardQueuedEvents,
  fingerprintOf,
  flushEvents,
  recordEvent,
  sanitiseMeta,
} from '../src/infra/eventLog.js';
import { logger } from '../src/infra/logger.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { requestContext } from '../src/middleware/requestContext.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { setFeature } from '../src/modules/config/index.js';
import { errorBurstCheckJob, purgeSystemEventsJob } from '../src/workers/jobs/events.js';
import { runJobOnce } from '../src/workers/scheduler.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'events-device-01', platform: 'android' as const };
const PASSWORD = 'correct horse battery staple';
let counter = 0;
const nextEmail = () => `events${counter++}.${Date.now()}@example.com`;

interface StoredRow {
  id: string;
  process: string;
  level: string;
  kind: string;
  event: string;
  code: string | null;
  message: string | null;
  fingerprint: string;
  trace_id: string | null;
  user_id: string | null;
  path: string | null;
  meta: Record<string, unknown>;
  occurred_at: Date;
}

async function rows(where = '', params: unknown[] = []): Promise<StoredRow[]> {
  await flushEvents();
  const { rows } = await pool.query<StoredRow>(
    `SELECT * FROM system_events ${where ? `WHERE ${where}` : ''} ORDER BY occurred_at DESC, id DESC`,
    params,
  );
  return rows;
}

const silence = () => {
  // The logger writes the line to stdout/stderr before storing it; the tests
  // are about the row, not the console.
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
};

async function staff(role = 'super_admin'): Promise<{ id: string; email: string }> {
  const email = nextEmail();
  const id = uuidv7();
  await pool.query(
    "INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, $3, 'active')",
    [id, email, await hashPassword(PASSWORD)],
  );
  await pool.query("INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Ops')", [id]);
  await pool.query(
    `INSERT INTO role_assignments (id, user_id, role_code, scope_type) VALUES ($1, $2, $3, 'global')`,
    [uuidv7(), id, role],
  );
  return { id, email };
}

async function adminCookie(who: { email: string }): Promise<string> {
  const res = await request(app).post('/admin/login').type('form').send({ email: who.email, password: PASSWORD });
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  return cookies?.find((c) => c.startsWith('dhun_admin='))?.split(';')[0] ?? '';
}

async function registerByEmail(email = nextEmail()) {
  const res = await request(app)
    .post('/v1/auth/email/register')
    .send({ email, password: PASSWORD, device: { ...DEVICE, deviceId: `ev-${uuidv7()}` } })
    .expect(201);
  return { id: res.body.user.id as string, token: res.body.accessToken as string, email };
}

beforeEach(async () => {
  await resetLedger();
  discardQueuedEvents();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await flushEvents();
  await closePool();
});

// ---------------------------------------------------------------------------

describe('sanitising', () => {
  it('redacts secrets by key name, wherever they sit', () => {
    const out = sanitiseMeta({
      password: 'hunter2',
      accessToken: 'eyJ…',
      refresh_token: 'abc',
      MSG91_AUTH_KEY: 'k',
      otp: '123456',
      devCode: '654321',
      nested: { authorization: 'Bearer x', panNumber: 'ABCDE1234F', fine: 'kept' },
      code: 'INTERNAL_ERROR',
    });
    expect(out.password).toBe('[redacted]');
    expect(out.accessToken).toBe('[redacted]');
    expect(out.refresh_token).toBe('[redacted]');
    expect(out.MSG91_AUTH_KEY).toBe('[redacted]');
    expect(out.otp).toBe('[redacted]');
    expect(out.devCode).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).authorization).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).panNumber).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).fine).toBe('kept');
    // `code` is the error code on nearly every row and must survive.
    expect(out.code).toBe('INTERNAL_ERROR');
  });

  it('clips long strings, caps depth and flattens an Error', () => {
    const err = new Error('boom');
    const out = sanitiseMeta({ long: 'x'.repeat(2_000), deep: { a: { b: { c: { d: 1 } } } } }, err);
    expect((out.long as string).length).toBeLessThanOrEqual(501);
    expect(JSON.stringify(out.deep)).toContain('[depth]');
    const flat = out.err as Record<string, unknown>;
    expect(flat.name).toBe('Error');
    expect(flat.message).toBe('boom');
    expect(typeof flat.stack).toBe('string');
  });

  it('keeps the whole object under 8 KB', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) big[`k${i}`] = 'y'.repeat(400);
    const out = sanitiseMeta(big);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(8 * 1024 + 64);
    expect(out['…']).toBe('[meta truncated]');
  });

  it('fingerprints by the first stack frame, not the message', () => {
    const a = new Error('user 1 failed');
    const b = new Error('user 2 failed');
    b.stack = a.stack!.replace('user 1 failed', 'user 2 failed');
    expect(fingerprintOf({ process: 'api', event: 'e', err: a })).toBe(
      fingerprintOf({ process: 'api', event: 'e', err: b }),
    );
    expect(fingerprintOf({ process: 'api', event: 'e', message: 'x' })).not.toBe(
      fingerprintOf({ process: 'api', event: 'f', message: 'x' }),
    );
  });
});

describe('recording', () => {
  it('stores a row and fills the trace, user and path from the request context', async () => {
    const userId = uuidv7();
    runWithContext({ traceId: 'trace-abc', userId, path: 'POST /v1/x' }, () => {
      recordEvent({ level: 'info', kind: 'auth', event: 'auth.signed_in', message: 'hi', meta: { token: 'nope', ok: 1 } });
    });
    const [row] = await rows("event = 'auth.signed_in'");
    expect(row.trace_id).toBe('trace-abc');
    expect(row.user_id).toBe(userId);
    expect(row.path).toBe('POST /v1/x');
    expect(row.process).toBe('api');
    expect(row.meta).toEqual({ token: '[redacted]', ok: 1 });
    expect(row.fingerprint).toHaveLength(16);
  });

  it('every logger.error is a row, with the error flattened; skipEventLog opts out', async () => {
    silence();
    logger.error('outbox drain failed', new Error('connection reset'), { attempt: 3 });
    logger.error('already recorded elsewhere', undefined, { skipEventLog: true });
    const all = await rows("kind = 'error'");
    expect(all).toHaveLength(1);
    expect(all[0].event).toBe('error.outbox_drain_failed');
    expect(all[0].message).toBe('outbox drain failed');
    expect((all[0].meta.err as Record<string, unknown>).message).toBe('connection reset');
    expect(all[0].meta.attempt).toBe(3);
    expect(all[0].meta.skipEventLog).toBeUndefined();
  });

  it('a 5xx is one row carrying its code, status and the trace id the client got', async () => {
    silence();
    const tiny = express();
    tiny.use(requestContext());
    tiny.get('/boom', () => {
      throw new Error('kaboom');
    });
    tiny.use(errorHandler());

    const res = await request(tiny).get('/boom').set('X-Trace-Id', 'trace-500').expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).not.toContain('kaboom');

    const all = await rows("trace_id = 'trace-500'");
    // One from the error handler; the request-timing line must not be a second.
    expect(all).toHaveLength(1);
    expect(all[0].code).toBe('INTERNAL_ERROR');
    expect(all[0].meta.status).toBe(500);
    expect(all[0].path).toBe('GET /boom');
    expect((all[0].meta.err as Record<string, unknown>).message).toBe('kaboom');
  });

  it('cannot be edited once written', async () => {
    recordEvent({ level: 'info', kind: 'auth', event: 'auth.signed_in' });
    const [row] = await rows();
    await expect(pool.query("UPDATE system_events SET message = 'x' WHERE id = $1", [row.id])).rejects.toThrow(
      /append-only/,
    );
  });
});

describe('the audit trail', () => {
  it('a sign-up, a wrong password and a deletion each leave a row — without the password or address', async () => {
    silence();
    const user = await registerByEmail();

    await request(app)
      .post('/v1/auth/email/login')
      .send({ email: user.email, password: 'wrong password here', device: DEVICE })
      .expect(401);
    // An unknown address is NOT recorded: there is no account, and the guess would be stored.
    await request(app)
      .post('/v1/auth/email/login')
      .send({ email: 'nobody@example.com', password: 'wrong password here', device: DEVICE })
      .expect(401);

    await request(app)
      .post('/v1/auth/account/delete')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ password: PASSWORD })
      .expect(200);

    const trail = await rows('user_id = $1', [user.id]);
    const events = trail.map((r) => r.event);
    expect(events).toContain('auth.signed_up');
    expect(events).toContain('auth.password_failed');
    expect(events).toContain('account.deleted');
    expect(trail.filter((r) => r.event === 'auth.password_failed')).toHaveLength(1);
    for (const row of trail) {
      const json = JSON.stringify(row);
      expect(json).not.toContain(PASSWORD);
      expect(json).not.toContain(user.email);
    }
  });

  it('a kill switch flip is a config row naming the actor and the reason', async () => {
    silence();
    const ops = await staff();
    await setFeature({ key: 'gifting', enabled: false, actorId: ops.id, reason: 'drill' });
    await setFeature({ key: 'gifting', enabled: true, actorId: ops.id, reason: 'drill over' });
    const all = await rows("event = 'config.feature_switched'");
    expect(all).toHaveLength(2);
    expect(all[0].user_id).toBe(ops.id);
    expect(all[0].code).toBe('gifting');
    expect(all[0].meta).toMatchObject({ feature: 'gifting', enabled: true, reason: 'drill over' });
  });
});

describe('what the app reports', () => {
  const batch = (events: unknown[]) => ({
    app: { version: '1.2.0', build: '42', platform: 'android', env: 'development' },
    events,
  });

  it('accepts a batch, as a guest too, and stores each as kind app', async () => {
    const res = await request(app)
      .post('/v1/client/events')
      .send(
        batch([
          {
            level: 'error',
            event: 'room_connect_failed',
            message: 'LiveKit refused',
            code: 'ROOM_CONNECT_FAILED',
            screen: 'room',
            traceId: 'trace-from-envelope',
            stack: 'Error: x\n  at y',
            meta: { roomId: '100042', attempt: 2, token: 'should-not-survive' },
          },
          { level: 'info', event: 'cold_start', occurredAt: '2099-01-01T00:00:00Z' },
        ]),
      )
      .expect(202);
    expect(res.body).toEqual({ accepted: 2 });

    const all = await rows("process = 'app'");
    expect(all).toHaveLength(2);
    const failed = all.find((r) => r.event === 'app.room_connect_failed')!;
    expect(failed.kind).toBe('app');
    expect(failed.level).toBe('error');
    expect(failed.code).toBe('ROOM_CONNECT_FAILED');
    expect(failed.trace_id).toBe('trace-from-envelope');
    expect(failed.path).toBe('screen room');
    expect(failed.user_id).toBeNull();
    expect(failed.meta).toMatchObject({ roomId: '100042', attempt: 2, token: '[redacted]', stack: 'Error: x\n  at y' });
    expect((failed.meta.app as Record<string, unknown>).version).toBe('1.2.0');

    // A timestamp from the future is replaced with the server's clock.
    const cold = all.find((r) => r.event === 'app.cold_start')!;
    expect(cold.occurred_at.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it('ties the row to the signed-in user', async () => {
    silence();
    const user = await registerByEmail();
    await request(app)
      .post('/v1/client/events')
      .set('Authorization', `Bearer ${user.token}`)
      .send(batch([{ level: 'warn', event: 'gift_queue_shed' }]))
      .expect(202);
    const [row] = await rows("event = 'app.gift_queue_shed'");
    expect(row.user_id).toBe(user.id);
  });

  it('refuses a malformed batch outright', async () => {
    await request(app).post('/v1/client/events').send(batch([])).expect(422);
    await request(app)
      .post('/v1/client/events')
      .send(batch([{ level: 'error', event: 'has spaces in it' }]))
      .expect(422);
    await request(app)
      .post('/v1/client/events')
      .send(batch([{ level: 'error', event: 'x', extra: true }]))
      .expect(422);
    await request(app)
      .post('/v1/client/events')
      .send(batch(Array.from({ length: 21 }, () => ({ level: 'info', event: 'x' }))))
      .expect(422);
    expect(await rows("process = 'app'")).toHaveLength(0);
  });
});

describe('the admin screen', () => {
  it('is ops-only: a content moderator is refused', async () => {
    silence();
    const mod = await staff('content_moderator');
    const cookie = await adminCookie(mod);
    await request(app).get('/admin/events').set('Cookie', cookie).expect(403);
  });

  it('groups the day by fingerprint, filters by level, and escapes what it shows', async () => {
    silence();
    const ops = await staff();
    const cookie = await adminCookie(ops);

    for (let i = 0; i < 3; i++) {
      recordEvent({ level: 'error', kind: 'error', event: 'error.same_bug', message: '<script>alert(1)</script>' });
    }
    recordEvent({ level: 'info', kind: 'auth', event: 'auth.signed_in', userId: ops.id });
    await flushEvents();

    const page = await request(app).get('/admin/events').set('Cookie', cookie).expect(200);
    expect(page.text).toContain('Breaking now');
    expect(page.text).toContain('error.same_bug');
    expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.text).not.toContain('<script>alert(1)</script>');
    // The group row counts three, and the latest list shows the sign-in too.
    expect(page.text).toMatch(/<strong>3<\/strong>/);
    expect(page.text).toContain('auth.signed_in');

    const errorsOnly = await request(app).get('/admin/events?level=error').set('Cookie', cookie).expect(200);
    expect(errorsOnly.text).toContain('error.same_bug');
    expect(errorsOnly.text).not.toContain('auth.signed_in');
    expect(errorsOnly.text).not.toContain('Breaking now');

    const byUser = await request(app).get(`/admin/events?userId=${ops.id}`).set('Cookie', cookie).expect(200);
    expect(byUser.text).toContain('auth.signed_in');
    expect(byUser.text).not.toContain('error.same_bug');
  });
});

describe('the jobs', () => {
  const insert = (level: string, ageDays: number, fingerprint = 'fp' + level.padEnd(14, '0')) =>
    pool.query(
      `INSERT INTO system_events (id, occurred_at, process, level, kind, event, fingerprint, meta)
       VALUES ($1, now() - make_interval(days => $2), 'api', $3, 'error', 'error.old', $4, '{}')`,
      [uuidv7(), ageDays, level, fingerprint],
    );

  it('purges by level with its own retention, and leaves recent rows alone', async () => {
    await insert('info', 31);
    await insert('info', 29);
    await insert('warn', 61);
    await insert('warn', 59);
    await insert('error', 91);
    await insert('error', 89);

    await runJobOnce(purgeSystemEventsJob);

    const left = await rows("event = 'error.old'");
    expect(left.map((r) => r.level).sort()).toEqual(['error', 'info', 'warn']);
    const { rows: run } = await pool.query(
      "SELECT status, result FROM job_runs WHERE job = 'purge_system_events' ORDER BY id DESC LIMIT 1",
    );
    expect(run[0].status).toBe('success');
    expect(run[0].result).toEqual({ deleted: { info: 1, warn: 1, error: 1 } });
  });

  it('alerts when one error repeats past the threshold, and records the alert', async () => {
    silence();
    const sent: Alert[] = [];
    setAlertTransport({ send: async (a) => void sent.push(a) });

    for (let i = 0; i < 20; i++) {
      recordEvent({ level: 'error', kind: 'error', event: 'error.ledger_timeout', message: 'timeout' });
    }
    for (let i = 0; i < 5; i++) {
      recordEvent({ level: 'error', kind: 'error', event: 'error.minor', message: 'rare' });
    }
    await flushEvents();

    await runJobOnce(errorBurstCheckJob);

    expect(sent).toHaveLength(1);
    expect(sent[0].severity).toBe('page');
    expect(sent[0].key).toMatch(/^error_burst:/);
    expect(sent[0].title).toContain('error.ledger_timeout');
    expect(sent[0].detail).toMatchObject({ count: 20, event: 'error.ledger_timeout' });

    const recorded = await rows("kind = 'alert'");
    expect(recorded).toHaveLength(1);
    expect(recorded[0].event).toBe('alert.page');
    expect(recorded[0].code).toBe(sent[0].key);
  });

  it('stays quiet under the threshold', async () => {
    const sent: Alert[] = [];
    setAlertTransport({ send: async (a) => void sent.push(a) });
    for (let i = 0; i < 19; i++) {
      recordEvent({ level: 'error', kind: 'error', event: 'error.ledger_timeout' });
    }
    await flushEvents();
    await runJobOnce(errorBurstCheckJob);
    expect(sent).toHaveLength(0);
  });
});
