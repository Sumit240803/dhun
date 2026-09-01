import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { closePool } from './helpers.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';

const app = buildApp();
const DEVICE = { deviceId: 'graph-device-0001', platform: 'android' };

let phoneCounter = 0;
const nextPhone = () => `+9195${String(40_000_000 + phoneCounter++).slice(-8)}`;

async function user() {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { ...DEVICE, deviceId: `gd-${phone}` } })
    .expect(200);

  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

beforeEach(async () => {
  // Each test signs up several users, and the OTP limiter is per IP. Without
  // this the suite starts failing partway through for a reason that has
  // nothing to do with what it is testing.
  await resetRateLimits();

  await pool.query('DELETE FROM messages');
  await pool.query('DELETE FROM thread_participants');
  await pool.query('DELETE FROM message_threads');
  await pool.query('DELETE FROM profile_visits');
  await pool.query('DELETE FROM follows');
});

afterAll(closePool);

describe('following', () => {
  it('is idempotent — a double tap is not an error', async () => {
    const me = await user();
    const them = await user();

    await request(app)
      .post(`/v1/users/${them.id}/follow`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    await request(app)
      .post(`/v1/users/${them.id}/follow`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    const summary = await request(app)
      .get('/v1/users/me/summary')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    expect(summary.body.summary.following).toBe(1);
  });

  it('unfollows, and unfollowing twice is also fine', async () => {
    const me = await user();
    const them = await user();

    await request(app)
      .post(`/v1/users/${them.id}/follow`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    await request(app)
      .delete(`/v1/users/${them.id}/follow`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    await request(app)
      .delete(`/v1/users/${them.id}/follow`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    const summary = await request(app)
      .get('/v1/users/me/summary')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    expect(summary.body.summary.following).toBe(0);
  });

  it('refuses to follow yourself', async () => {
    const me = await user();

    const res = await request(app)
      .post(`/v1/users/${me.id}/follow`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(422);

    expect(res.body.error.code).toBe('CANNOT_FOLLOW_SELF');
  });

  it('404s on an account that does not exist, rather than a constraint error', async () => {
    const me = await user();

    const res = await request(app)
      .post(`/v1/users/${uuidv7()}/follow`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(404);

    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('rejects an id that is not a uuid', async () => {
    const me = await user();
    await request(app)
      .post('/v1/users/not-a-uuid/follow')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(422);
  });

  it('requires a session', async () => {
    const them = await user();
    await request(app).post(`/v1/users/${them.id}/follow`).expect(401);
  });
});

describe('visitors', () => {
  it('records a visit, counts it as new, and clears it when seen', async () => {
    const me = await user();
    const them = await user();

    await request(app)
      .post(`/v1/users/${me.id}/visit`)
      .set('Authorization', `Bearer ${them.token}`)
      .expect(204);

    const before = await request(app)
      .get('/v1/users/me/summary')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(before.body.summary.newVisitors).toBe(1);

    const cleared = await request(app)
      .post('/v1/users/me/visitors/seen')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(cleared.body.cleared).toBe(1);

    const after = await request(app)
      .get('/v1/users/me/summary')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(after.body.summary.newVisitors).toBe(0);
  });

  it('does not record you visiting yourself', async () => {
    const me = await user();

    await request(app)
      .post(`/v1/users/${me.id}/visit`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(204);

    const res = await request(app)
      .get('/v1/users/me/visitors')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    expect(res.body.visitors).toHaveLength(0);
  });

  it('surfaces a returning visitor again by clearing seen_at', async () => {
    const me = await user();
    const them = await user();

    await request(app)
      .post(`/v1/users/${me.id}/visit`)
      .set('Authorization', `Bearer ${them.token}`)
      .expect(204);
    await request(app)
      .post('/v1/users/me/visitors/seen')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    await request(app)
      .post(`/v1/users/${me.id}/visit`)
      .set('Authorization', `Bearer ${them.token}`)
      .expect(204);

    const res = await request(app)
      .get('/v1/users/me/summary')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    expect(res.body.summary.newVisitors).toBe(1);
  });

  it('reports whether the owner already follows each visitor', async () => {
    const me = await user();
    const them = await user();

    await request(app)
      .post(`/v1/users/${me.id}/visit`)
      .set('Authorization', `Bearer ${them.token}`)
      .expect(204);

    const before = await request(app)
      .get('/v1/users/me/visitors')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(before.body.visitors[0].following).toBe(false);

    await request(app)
      .post(`/v1/users/${them.id}/follow`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    const after = await request(app)
      .get('/v1/users/me/visitors')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(after.body.visitors[0].following).toBe(true);
  });
});

describe('reading a thread', () => {
  async function threadWith(userId: string) {
    const threadId = uuidv7();
    await pool.query(
      `INSERT INTO message_threads (id, kind, title, accent) VALUES ($1,'official','Payouts','money')`,
      [threadId],
    );
    await pool.query(
      `INSERT INTO thread_participants (thread_id, user_id, last_read_at) VALUES ($1,$2,NULL)`,
      [threadId, userId],
    );
    await pool.query(
      `INSERT INTO messages (id, thread_id, sender_user_id, body) VALUES ($1,$2,NULL,'Hello')`,
      [uuidv7(), threadId],
    );
    return threadId;
  }

  it('clears the unread badge', async () => {
    const me = await user();
    const threadId = await threadWith(me.id);

    const before = await request(app)
      .get('/v1/messages/threads')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(before.body.threads[0].unread).toBe(1);

    await request(app)
      .post(`/v1/messages/threads/${threadId}/read`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    const after = await request(app)
      .get('/v1/messages/threads')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(after.body.threads[0].unread).toBe(0);
  });

  it('404s for a thread you are not in, rather than 403', async () => {
    // A 403 confirms the thread exists, which is itself a leak.
    const me = await user();
    const stranger = await user();
    const threadId = await threadWith(stranger.id);

    await request(app)
      .post(`/v1/messages/threads/${threadId}/read`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(404);
  });

  it('returns no messages for a thread you are not in', async () => {
    const me = await user();
    const stranger = await user();
    const threadId = await threadWith(stranger.id);

    const res = await request(app)
      .get(`/v1/messages/threads/${threadId}/messages`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    expect(res.body.messages).toHaveLength(0);
  });

  it('marks a platform message as not mine', async () => {
    const me = await user();
    const threadId = await threadWith(me.id);

    const res = await request(app)
      .get(`/v1/messages/threads/${threadId}/messages`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    expect(res.body.messages[0].mine).toBe(false);
    expect(res.body.messages[0].senderId).toBeNull();
  });
});

describe('client config', () => {
  it('is readable without a session, because a force-update must reach a signed-out user', async () => {
    const res = await request(app).get('/v1/config/app').expect(200);

    expect(res.body.config.minSupportedVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof res.body.config.flags.giftingEnabled).toBe('boolean');
  });

  it('drops a non-boolean flag rather than handing it to the client', async () => {
    await pool.query(
      `UPDATE app_config SET value = '{"giftingEnabled": true, "broken": "yes"}'::jsonb
        WHERE key = 'client_flags'`,
    );

    const res = await request(app).get('/v1/config/app').expect(200);

    expect(res.body.config.flags.giftingEnabled).toBe(true);
    expect(res.body.config.flags.broken).toBeUndefined();
  });
});
