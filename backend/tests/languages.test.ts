import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { invalidateCatalogCache } from '../src/modules/economy/index.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { defaultRoomLanguage } from '../src/shared/languages.js';
import { closePool } from './helpers.js';

// "Nearby", as the founder decided it on 2026-11-03: by LANGUAGE, never by
// place (build-plan M20, migration 040).

const app = buildApp();

let phoneCounter = 0;
const nextPhone = () => `+9195${String(40_000_000 + phoneCounter++).slice(-8)}`;

async function registeredUser(): Promise<{ token: string; userId: string }> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({
      phone,
      code: otp.body.devCode,
      device: { deviceId: `lang-${phone}`, platform: 'android' },
    })
    .expect(200);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

const auth = (user: { token: string }) => ({ Authorization: `Bearer ${user.token}` });

/** A live room in one language, inserted directly so the feed has something to filter. */
async function liveRoom(language: string, viewers = 100): Promise<string> {
  const userId = uuidv7();
  const roomId = uuidv7();
  await pool.query(
    `INSERT INTO users (id, status, phone_e164, phone_verified_at) VALUES ($1,'active',$2, now())`,
    [userId, nextPhone()],
  );
  await pool.query(`INSERT INTO user_profiles (user_id, display_name) VALUES ($1,'Host')`, [userId]);
  await pool.query(
    `INSERT INTO rooms (id, host_user_id, title, tag, is_video, viewer_count, language)
          VALUES ($1,$2,'Room','chatting', false, $3, $4)`,
    [roomId, userId, viewers, language],
  );
  return roomId;
}

beforeEach(async () => {
  await resetRateLimits();
  await pool.query('DELETE FROM rooms');
  // Lift the cold-start cap so the feed shows every room the test made.
  await pool.query(
    `UPDATE app_config SET value = value || '{"maxFeedRooms": null}'::jsonb WHERE key = 'cold_start'`,
  );
  invalidateCatalogCache();
});

afterAll(async () => {
  await pool.query(
    `UPDATE app_config SET value = value || '{"maxFeedRooms": 4}'::jsonb WHERE key = 'cold_start'`,
  );
  await closePool();
});

describe('profile languages', () => {
  it('starts empty and is saved whole, in order', async () => {
    const user = await registeredUser();
    const me = await request(app).get('/v1/auth/me').set(auth(user)).expect(200);
    expect(me.body.user.languages).toEqual([]);

    const res = await request(app)
      .patch('/v1/auth/profile')
      .set(auth(user))
      .send({ languages: ['bho', 'hi'] })
      .expect(200);
    expect(res.body.user.languages).toEqual(['bho', 'hi']);

    // Replaced, never appended — so a retried request cannot grow the list.
    const again = await request(app)
      .patch('/v1/auth/profile')
      .set(auth(user))
      .send({ languages: ['ta'] })
      .expect(200);
    expect(again.body.user.languages).toEqual(['ta']);
  });

  it('is left alone by a profile edit that does not mention it', async () => {
    const user = await registeredUser();
    await request(app).patch('/v1/auth/profile').set(auth(user)).send({ languages: ['mr'] }).expect(200);
    const res = await request(app)
      .patch('/v1/auth/profile')
      .set(auth(user))
      .send({ bio: 'Gaana sunao' })
      .expect(200);
    expect(res.body.user.languages).toEqual(['mr']);
  });

  it.each([
    ['an unknown code', ['xx']],
    ['an empty list', []],
    ['more than three', ['hi', 'en', 'ta', 'te']],
    ['a repeat', ['hi', 'hi']],
    ['a string, not a list', 'hi'],
  ])('refuses %s', async (_label, languages) => {
    const user = await registeredUser();
    const res = await request(app)
      .patch('/v1/auth/profile')
      .set(auth(user))
      .send({ languages })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    // The field path, never the caller's own input echoed back.
    expect(JSON.stringify(res.body)).not.toContain('"xx"');
  });
});

describe('a room language', () => {
  it('is the one the host picked', async () => {
    const host = await registeredUser();
    const res = await request(app)
      .post('/v1/rooms/live')
      .set(auth(host))
      .send({ title: 'Bhojpuri geet', tag: 'singing', language: 'bho' })
      .expect(201);
    expect(res.body.room.language).toBe('bho');
  });

  it("defaults to the host's first listed language", async () => {
    const host = await registeredUser();
    await request(app)
      .patch('/v1/auth/profile')
      .set(auth(host))
      .send({ languages: ['bn', 'hi'] })
      .expect(200);
    const res = await request(app)
      .post('/v1/rooms/live')
      .set(auth(host))
      .send({ title: 'Adda', tag: 'chatting' })
      .expect(201);
    expect(res.body.room.language).toBe('bn');
  });

  it('falls back to the app language, then Hindi', () => {
    expect(defaultRoomLanguage([], 'en-IN')).toBe('en');
    expect(defaultRoomLanguage([], 'hi-IN')).toBe('hi');
    expect(defaultRoomLanguage([], null)).toBe('hi');
    expect(defaultRoomLanguage(['zz'], 'fr-FR')).toBe('hi');
  });

  it('refuses a language that is not on the list', async () => {
    const host = await registeredUser();
    await request(app)
      .post('/v1/rooms/live')
      .set(auth(host))
      .send({ title: 'Room', tag: 'chatting', language: 'klingon' })
      .expect(422);
  });

  it('does not move when the host edits their profile mid-broadcast', async () => {
    const host = await registeredUser();
    const live = await request(app)
      .post('/v1/rooms/live')
      .set(auth(host))
      .send({ title: 'Room', tag: 'chatting', language: 'gu' })
      .expect(201);
    await request(app).patch('/v1/auth/profile').set(auth(host)).send({ languages: ['pa'] }).expect(200);
    const room = await request(app).get(`/v1/rooms/${live.body.room.id}`).set(auth(host)).expect(200);
    expect(room.body.room.language).toBe('gu');
  });
});

describe('going live with the fields the app sends', () => {
  // The app has sent a face frame and a device id since M16, and the strict
  // schema refused both — so every go-live from a real phone was a 422.
  it('accepts a face frame and a device id', async () => {
    const host = await registeredUser();
    await request(app)
      .post('/v1/rooms/live')
      .set(auth(host))
      .send({
        title: 'Room',
        tag: 'chatting',
        faceKey: `faces/${host.userId}/not-uploaded.jpg`,
        deviceId: 'lang-device-0001',
      })
      .expect(201);
  });
});

describe('the feed by language', () => {
  it('narrows to one language when asked, and shows all of them when not', async () => {
    const hindi = await liveRoom('hi', 300);
    const bhojpuri = await liveRoom('bho', 200);
    const tamil = await liveRoom('ta', 100);

    const all = await request(app).get('/v1/rooms/feed?category=explore').expect(200);
    expect(all.body.rooms.map((room: { id: string }) => room.id)).toEqual([hindi, bhojpuri, tamil]);
    expect(all.body.rooms[1].language).toBe('bho');

    const only = await request(app).get('/v1/rooms/feed?category=explore&language=bho').expect(200);
    expect(only.body.rooms.map((room: { id: string }) => room.id)).toEqual([bhojpuri]);
  });

  it('is empty, not an error, for a language nobody is live in', async () => {
    await liveRoom('hi');
    const res = await request(app).get('/v1/rooms/feed?category=explore&language=ml').expect(200);
    expect(res.body.rooms).toEqual([]);
  });

  it('refuses a language that is not on the list', async () => {
    await request(app).get('/v1/rooms/feed?language=xx').expect(422);
    await request(app).get(`/v1/rooms/feed?language=${'a'.repeat(300)}`).expect(422);
  });

  it('never accepts a place', async () => {
    // State, city and coordinates were ruled out by the founder. The strict
    // query schema is what keeps them from arriving quietly.
    await request(app).get('/v1/rooms/feed?state=UP').expect(422);
    await request(app).get('/v1/rooms/feed?lat=28.6&lng=77.2').expect(422);
  });
});
