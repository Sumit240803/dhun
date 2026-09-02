import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { closePool } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'mod-device-0001', platform: 'android' };

let phoneCounter = 0;
const nextPhone = () => `+9194${String(50_000_000 + phoneCounter++).slice(-8)}`;

async function user() {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { ...DEVICE, deviceId: `md-${phone}` } })
    .expect(200);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

async function liveRoomFor(hostId: string) {
  const roomId = uuidv7();
  await pool.query(
    `INSERT INTO rooms (id, host_user_id, title, tag, viewer_count) VALUES ($1,$2,'Room','chatting',10)`,
    [roomId, hostId],
  );
  return roomId;
}

beforeEach(async () => {
  await resetRateLimits();
  await pool.query('DELETE FROM reports');
  await pool.query('DELETE FROM blocks');
  await pool.query('DELETE FROM rooms');
  await pool.query('DELETE FROM follows');
});

afterAll(closePool);

describe('reporting', () => {
  it('accepts a report with 202, because acceptance is all it can promise', async () => {
    const me = await user();
    const them = await user();

    const res = await request(app)
      .post('/v1/moderation/reports')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ subjectType: 'user', subjectId: them.id, reason: 'harassment' })
      .expect(202);

    expect(res.body.filed).toBe(true);
  });

  it('keeps one row per reporter, so twenty people still count as twenty', async () => {
    const a = await user();
    const b = await user();
    const target = await user();

    for (const reporter of [a, b]) {
      await request(app)
        .post('/v1/moderation/reports')
        .set('Authorization', `Bearer ${reporter.token}`)
        .send({ subjectType: 'user', subjectId: target.id, reason: 'spam' })
        .expect(202);
    }

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM reports WHERE subject_id = $1', [
      target.id,
    ]);
    expect(rows[0].n).toBe(2);
  });

  it('does not let one person inflate the count by reporting twice in a day', async () => {
    const me = await user();
    const them = await user();

    const first = await request(app)
      .post('/v1/moderation/reports')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ subjectType: 'user', subjectId: them.id, reason: 'spam' })
      .expect(202);
    expect(first.body.filed).toBe(true);

    // Succeeds, but records nothing. Telling a user off for reporting twice
    // teaches them not to report.
    const second = await request(app)
      .post('/v1/moderation/reports')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ subjectType: 'user', subjectId: them.id, reason: 'spam' })
      .expect(202);
    expect(second.body.filed).toBe(false);
  });

  it('refuses a reason outside the closed set', async () => {
    const me = await user();
    const them = await user();

    await request(app)
      .post('/v1/moderation/reports')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ subjectType: 'user', subjectId: them.id, reason: 'i-do-not-like-them' })
      .expect(422);
  });

  it('refuses to report yourself', async () => {
    const me = await user();

    const res = await request(app)
      .post('/v1/moderation/reports')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ subjectType: 'user', subjectId: me.id, reason: 'spam' })
      .expect(422);

    expect(res.body.error.code).toBe('CANNOT_REPORT_SELF');
  });

  it('404s on a subject that does not exist', async () => {
    const me = await user();

    await request(app)
      .post('/v1/moderation/reports')
      .set('Authorization', `Bearer ${me.token}`)
      .send({ subjectType: 'room', subjectId: uuidv7(), reason: 'nudity' })
      .expect(404);
  });

  it('requires a session', async () => {
    const them = await user();
    await request(app)
      .post('/v1/moderation/reports')
      .send({ subjectType: 'user', subjectId: them.id, reason: 'spam' })
      .expect(401);
  });
});

describe('blocking', () => {
  it('hides the blocked host from the feed', async () => {
    const me = await user();
    const host = await user();
    await liveRoomFor(host.id);

    const before = await request(app)
      .get('/v1/rooms/feed')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(before.body.rooms).toHaveLength(1);

    await request(app)
      .post(`/v1/users/${host.id}/block`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    const after = await request(app)
      .get('/v1/rooms/feed')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(after.body.rooms).toHaveLength(0);
  });

  it('hides the room in BOTH directions', async () => {
    // A one-way block that leaves the blocked person able to watch is a mute,
    // not a block.
    const me = await user();
    const host = await user();
    await liveRoomFor(me.id);

    await request(app)
      .post(`/v1/users/${host.id}/block`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    const res = await request(app)
      .get('/v1/rooms/feed')
      .set('Authorization', `Bearer ${host.token}`)
      .expect(200);

    expect(res.body.rooms).toHaveLength(0);
  });

  it('makes the profile 404, not 403 — a 403 confirms the account exists', async () => {
    const me = await user();
    const them = await user();

    await request(app)
      .get(`/v1/users/${them.id}/profile`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    await request(app)
      .post(`/v1/users/${them.id}/block`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    await request(app)
      .get(`/v1/users/${them.id}/profile`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(404);
  });

  it('unblocks, and does not disturb the follow', async () => {
    const me = await user();
    const them = await user();

    await request(app)
      .post(`/v1/users/${them.id}/follow`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    await request(app)
      .post(`/v1/users/${them.id}/block`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    await request(app)
      .delete(`/v1/users/${them.id}/block`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    const res = await request(app)
      .get(`/v1/users/${them.id}/profile`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    // Blocking and unfollowing are separate intentions.
    expect(res.body.profile.isFollowing).toBe(true);
  });

  it('refuses to block yourself', async () => {
    const me = await user();

    const res = await request(app)
      .post(`/v1/users/${me.id}/block`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(422);

    expect(res.body.error.code).toBe('CANNOT_BLOCK_SELF');
  });
});

describe('public profile', () => {
  it('shows only what a stranger may see', async () => {
    const me = await user();
    const them = await user();

    const res = await request(app)
      .get(`/v1/users/${them.id}/profile`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    expect(res.body.profile.publicId).toMatch(/^\d+$/);
    // Never leaked to a stranger.
    expect(res.body.profile.points).toBeUndefined();
    expect(res.body.profile.newVisitors).toBeUndefined();
    expect(res.body.profile.phone).toBeUndefined();
  });

  it('reports the live room when the host is broadcasting', async () => {
    const me = await user();
    const host = await user();
    const roomId = await liveRoomFor(host.id);

    const res = await request(app)
      .get(`/v1/users/${host.id}/profile`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    expect(res.body.profile.liveRoomId).toBe(roomId);
  });

  it('does not let /me be parsed as an id', async () => {
    // The route order trap: ':id' placed before the /me routes swallows them.
    const me = await user();

    await request(app)
      .get('/v1/users/me/summary')
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
  });
});
