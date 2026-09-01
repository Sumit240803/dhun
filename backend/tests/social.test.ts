import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { closePool } from './helpers.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';

const app = buildApp();
const DEVICE = { deviceId: 'social-device-0001', platform: 'android' };

let phoneCounter = 0;
const nextPhone = () => `+9196${String(30_000_000 + phoneCounter++).slice(-8)}`;

async function registeredUser() {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { ...DEVICE, deviceId: `sd-${phone}` } })
    .expect(200);

  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

/** A host with one live room. Returns the ids so a test can follow or end it. */
async function liveHost(options: { seats?: number | null; viewers?: number } = {}) {
  const userId = uuidv7();
  const roomId = uuidv7();
  const phone = nextPhone();

  await pool.query(
    `INSERT INTO users (id, status, phone_e164, phone_verified_at) VALUES ($1,'active',$2, now())`,
    [userId, phone],
  );
  await pool.query(
    `INSERT INTO user_profiles (user_id, display_name, country) VALUES ($1,$2,'IN')`,
    [userId, `Host ${phone.slice(-4)}`],
  );
  await pool.query(
    `INSERT INTO rooms (id, host_user_id, title, tag, is_video, seat_capacity, seats_taken, viewer_count)
          VALUES ($1,$2,'Test room','chatting', true, $3, $4, $5)`,
    [roomId, userId, options.seats ?? null, options.seats == null ? 0 : 2, options.viewers ?? 100],
  );

  return { userId, roomId };
}

beforeEach(async () => {
  // Each test signs up several users, and the OTP limiter is per IP. Without
  // this the suite starts failing partway through for a reason that has
  // nothing to do with what it is testing.
  await resetRateLimits();

  await pool.query('DELETE FROM messages');
  await pool.query('DELETE FROM thread_participants');
  await pool.query('DELETE FROM message_threads');
  await pool.query('DELETE FROM rooms');
  await pool.query('DELETE FROM follows');
  await pool.query('DELETE FROM banners');
});

afterAll(closePool);

describe('room feed', () => {
  it('is readable without a session, because browsing is the top of the funnel', async () => {
    await liveHost({ viewers: 500 });

    const res = await request(app).get('/v1/rooms/feed').expect(200);

    expect(res.body.rooms).toHaveLength(1);
    expect(res.body.rooms[0].viewers).toBe(500);
  });

  it('separates live rooms from party rooms by seat capacity', async () => {
    await liveHost({ seats: null });
    await liveHost({ seats: 8 });

    const explore = await request(app).get('/v1/rooms/feed?category=explore').expect(200);
    const party = await request(app).get('/v1/rooms/feed?category=party').expect(200);

    expect(explore.body.rooms).toHaveLength(1);
    expect(explore.body.rooms[0].seatCount).toBeNull();

    expect(party.body.rooms).toHaveLength(1);
    expect(party.body.rooms[0].seatCount).toBe(2);
  });

  it('hides a room once it ends', async () => {
    const host = await liveHost();
    await request(app).get('/v1/rooms/feed').expect(200);

    await pool.query('UPDATE rooms SET ended_at = now() WHERE id = $1', [host.roomId]);

    const res = await request(app).get('/v1/rooms/feed').expect(200);
    expect(res.body.rooms).toHaveLength(0);
  });

  it('orders by viewers, and flags the busiest as trending', async () => {
    await liveHost({ viewers: 10 });
    await liveHost({ viewers: 9_000 });

    const res = await request(app).get('/v1/rooms/feed').expect(200);

    expect(res.body.rooms[0].viewers).toBe(9_000);
    expect(res.body.rooms[0].trending).toBe(true);
  });

  it('returns nothing for Following when signed out, rather than everything', async () => {
    // The failure this guards: ignoring the filter for a guest and showing the
    // whole feed, which looks like it worked and is silently wrong.
    await liveHost();

    const res = await request(app).get('/v1/rooms/feed?category=following').expect(200);

    expect(res.body.rooms).toHaveLength(0);
  });

  it('returns only followed hosts for Following when signed in', async () => {
    const user = await registeredUser();
    const followed = await liveHost({ viewers: 10 });
    await liveHost({ viewers: 20 });

    await pool.query('INSERT INTO follows (follower_user_id, followee_user_id) VALUES ($1,$2)', [
      user.userId,
      followed.userId,
    ]);

    const res = await request(app)
      .get('/v1/rooms/feed?category=following')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(res.body.rooms).toHaveLength(1);
    expect(res.body.rooms[0].id).toBe(followed.roomId);
  });

  it('rejects an unbounded limit', async () => {
    await request(app).get('/v1/rooms/feed?limit=5000').expect(422);
  });

  it('rejects an unknown query key rather than ignoring it', async () => {
    await request(app).get('/v1/rooms/feed?sortBy=payout').expect(422);
  });

  it('refuses a second live room for the same host', async () => {
    const host = await liveHost();

    // A reconnect storm creating a second room would split the gifts across
    // two rooms and show the host twice in the feed.
    await expect(
      pool.query(
        `INSERT INTO rooms (id, host_user_id, title, tag) VALUES ($1,$2,'Second','chatting')`,
        [uuidv7(), host.userId],
      ),
    ).rejects.toThrow();
  });
});

describe('message threads', () => {
  it('requires a session', async () => {
    await request(app).get('/v1/messages/threads').expect(401);
  });

  it('counts unread from the read watermark', async () => {
    const user = await registeredUser();
    const threadId = uuidv7();

    await pool.query(
      `INSERT INTO message_threads (id, kind, title, accent) VALUES ($1,'official','Payouts','money')`,
      [threadId],
    );
    await pool.query(
      `INSERT INTO thread_participants (thread_id, user_id, last_read_at) VALUES ($1,$2,NULL)`,
      [threadId, user.userId],
    );
    await pool.query(
      `INSERT INTO messages (id, thread_id, sender_user_id, body) VALUES ($1,$2,NULL,'One'),($3,$2,NULL,'Two')`,
      [uuidv7(), threadId, uuidv7()],
    );

    const unread = await request(app)
      .get('/v1/messages/threads')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(unread.body.threads[0].unread).toBe(2);
    expect(unread.body.threads[0].official).toBe(true);
    expect(unread.body.threads[0].preview).toBe('Two');

    // Moving the watermark forward clears it — no counter to decrement.
    await pool.query('UPDATE thread_participants SET last_read_at = now() WHERE thread_id = $1', [
      threadId,
    ]);

    const read = await request(app)
      .get('/v1/messages/threads')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(read.body.threads[0].unread).toBe(0);
  });

  it('never shows a thread the user is not in', async () => {
    const user = await registeredUser();
    const stranger = await registeredUser();
    const threadId = uuidv7();

    await pool.query(
      `INSERT INTO message_threads (id, kind, title) VALUES ($1,'group','Someone else''s group')`,
      [threadId],
    );
    await pool.query(`INSERT INTO thread_participants (thread_id, user_id) VALUES ($1,$2)`, [
      threadId,
      stranger.userId,
    ]);

    const res = await request(app)
      .get('/v1/messages/threads')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(res.body.threads).toHaveLength(0);
  });
});

describe('profile summary', () => {
  it('counts a friend only when the follow is mutual', async () => {
    const user = await registeredUser();
    const other = await liveHost();

    await pool.query('INSERT INTO follows (follower_user_id, followee_user_id) VALUES ($1,$2)', [
      user.userId,
      other.userId,
    ]);

    const oneWay = await request(app)
      .get('/v1/users/me/summary')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(oneWay.body.summary.following).toBe(1);
    expect(oneWay.body.summary.friends).toBe(0);

    await pool.query('INSERT INTO follows (follower_user_id, followee_user_id) VALUES ($1,$2)', [
      other.userId,
      user.userId,
    ]);

    const mutual = await request(app)
      .get('/v1/users/me/summary')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(mutual.body.summary.friends).toBe(1);
    expect(mutual.body.summary.followers).toBe(1);
  });

  it('gives every user a short public id that is not their uuid', async () => {
    const user = await registeredUser();

    const res = await request(app)
      .get('/v1/users/me/summary')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(res.body.summary.publicId).toMatch(/^\d{8,}$/);
    expect(res.body.summary.publicId).not.toBe(user.userId);
  });
});

describe('banners', () => {
  async function insertBanner(overrides: { endsAt?: string; active?: boolean } = {}) {
    await pool.query(
      `INSERT INTO banners (id, title, subtitle, ends_at, action, theme, is_active)
            VALUES ($1,'Ranking','Top hosts share a pool', ${overrides.endsAt ?? 'NULL'},
                    'ranking','gold', $2)`,
      [uuidv7(), overrides.active ?? true],
    );
  }

  it('is readable without a session', async () => {
    await insertBanner();
    const res = await request(app).get('/v1/config/banners').expect(200);
    expect(res.body.banners).toHaveLength(1);
  });

  it('hides an expired banner immediately, not on a sweep', async () => {
    await insertBanner({ endsAt: "now() - interval '1 hour'" });
    const res = await request(app).get('/v1/config/banners').expect(200);
    expect(res.body.banners).toHaveLength(0);
  });

  it('hides a deactivated banner, which is the kill switch', async () => {
    await insertBanner({ active: false });
    const res = await request(app).get('/v1/config/banners').expect(200);
    expect(res.body.banners).toHaveLength(0);
  });

  it('refuses an action the client does not know how to handle', async () => {
    // A closed set, so a compromised config row cannot send users somewhere
    // the app never agreed to open.
    await expect(
      pool.query(
        `INSERT INTO banners (id, title, subtitle, action, theme)
              VALUES ($1,'X','Y','open-url','gold')`,
        [uuidv7()],
      ),
    ).rejects.toThrow();
  });
});
