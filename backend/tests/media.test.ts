// Image uploads.
//
// The rules worth a test are the ones that stop someone putting an image where
// it does not belong: the server names the key, a key only works for the person
// it was issued to, and nothing is stored for an object that was never actually
// uploaded.
import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked at the module boundary, so the tests exercise every rule in
// media.service without reaching Cloudflare. The provider interface exists
// precisely so this is one object rather than a network stub.
const stored = new Map<string, { bytes: number; contentType: string | null }>();
vi.mock('../src/modules/media/r2.provider.js', () => ({
  r2: {
    presignUpload: async ({ key }: { key: string }) => ({
      url: `https://r2.test/upload/${key}?signature=stub`,
      key,
      expiresInSeconds: 600,
    }),
    statObject: async (key: string) => stored.get(key) ?? null,
  },
}));

const { buildApp } = await import('../src/app.js');
const { config } = await import('../src/config/index.js');
const { pool } = await import('../src/infra/db.js');
const { closePool, resetLedger } = await import('./helpers.js');

const app = buildApp();
let phoneCounter = 0;
const nextPhone = () => `+9189000${String(10_000 + phoneCounter++).slice(-5)}`;

async function registered(name = 'Asha') {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({
      phone,
      code: otp.body.devCode,
      device: { deviceId: `md-${randomUUID()}`, platform: 'android' },
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

const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

/** Stands in for the app PUTting the bytes to R2. */
function uploadFinished(key: string, bytes = 120_000) {
  stored.set(key, { bytes, contentType: 'image/jpeg' });
}

beforeEach(async () => {
  stored.clear();
  await resetLedger();
});
afterAll(closePool);

describe('asking for an upload', () => {
  it('names the key itself, scoped to the user', async () => {
    const user = await registered();
    const res = await request(app)
      .post('/v1/media/uploads')
      .set(auth(user))
      .send({ purpose: 'avatar', contentType: 'image/jpeg' })
      .expect(201);

    // The client asked for an avatar and got a key it did not choose.
    expect(res.body.key).toMatch(new RegExp(`^avatars/${user.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(res.body.url).toContain(res.body.key);
    expect(res.body.maxBytes).toBe(3 * 1024 * 1024);
  });

  it('gives each request a new key, so one upload cannot overwrite another', async () => {
    const user = await registered();
    const keys = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/v1/media/uploads')
        .set(auth(user))
        .send({ purpose: 'avatar', contentType: 'image/png' })
        .expect(201);
      keys.add(res.body.key);
    }
    expect(keys.size).toBe(3);
  });

  it('refuses a format that is not an image, SVG above all', async () => {
    const user = await registered();
    for (const contentType of ['image/svg+xml', 'text/html', 'application/pdf']) {
      const res = await request(app)
        .post('/v1/media/uploads')
        .set(auth(user))
        .send({ purpose: 'avatar', contentType })
        .expect(422);
      expect(res.body.error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    }
  });

  it('is closed to guests and to anyone signed out', async () => {
    await request(app)
      .post('/v1/media/uploads')
      .send({ purpose: 'avatar', contentType: 'image/jpeg' })
      .expect(401);
  });
});

describe('claiming an upload', () => {
  async function slot(user: { token: string }, purpose = 'avatar') {
    const res = await request(app)
      .post('/v1/media/uploads')
      .set(auth(user))
      .send({ purpose, contentType: 'image/jpeg' })
      .expect(201);
    return res.body.key as string;
  }

  it('sets the avatar, and derives the URL from config rather than the client', async () => {
    const user = await registered('Riya');
    const key = await slot(user);
    uploadFinished(key);

    await request(app)
      .patch('/v1/auth/profile')
      .set(auth(user))
      .send({ avatarKey: key })
      .expect(200);

    const { rows } = await pool.query(
      'SELECT avatar_url, avatar_key FROM user_profiles WHERE user_id = $1',
      [user.id],
    );
    expect(rows[0].avatar_key).toBe(key);
    expect(rows[0].avatar_url).toBe(`${config.media.publicUrl}/${key}`);
  });

  it('refuses a key belonging to somebody else', async () => {
    const owner = await registered('Owner');
    const thief = await registered('Thief');
    const key = await slot(owner);
    uploadFinished(key);

    const res = await request(app)
      .patch('/v1/auth/profile')
      .set(auth(thief))
      .send({ avatarKey: key })
      .expect(403);
    expect(res.body.error.code).toBe('UPLOAD_NOT_YOURS');
  });

  it('refuses a key that was never uploaded', async () => {
    const user = await registered();
    const key = await slot(user); // presigned, but no bytes ever PUT

    const res = await request(app)
      .patch('/v1/auth/profile')
      .set(auth(user))
      .send({ avatarKey: key })
      .expect(409);
    expect(res.body.error.code).toBe('UPLOAD_NOT_FOUND');
  });

  it('refuses a key invented by hand, including a traversal', async () => {
    const user = await registered();
    for (const key of [
      'avatars/../../secrets/key.jpg',
      'covers/other-user/abc.jpg',
      `avatars/${user.id}x/abc.jpg`,
    ]) {
      uploadFinished(key);
      await request(app)
        .patch('/v1/auth/profile')
        .set(auth(user))
        .send({ avatarKey: key })
        .expect(403);
    }
  });

  it('will not let an avatar slot be used as a room cover', async () => {
    const user = await registered('Host');
    const avatarKey = await slot(user, 'avatar');
    uploadFinished(avatarKey);

    const res = await request(app)
      .post('/v1/rooms/live')
      .set(auth(user))
      .send({ title: 'Evening ghazals', tag: 'chatting', coverKey: avatarKey })
      .expect(403);
    expect(res.body.error.code).toBe('UPLOAD_NOT_YOURS');
  });

  it('sets a room cover from a cover upload', async () => {
    const user = await registered('Host');
    const key = await slot(user, 'room_cover');
    uploadFinished(key, 400_000);

    const res = await request(app)
      .post('/v1/rooms/live')
      .set(auth(user))
      .send({ title: 'Evening ghazals', tag: 'chatting', coverKey: key })
      .expect(201);
    expect(res.body.room.coverUrl).toBe(`${config.media.publicUrl}/${key}`);

    const { rows } = await pool.query('SELECT cover_key FROM rooms WHERE id = $1', [
      res.body.room.id,
    ]);
    expect(rows[0].cover_key).toBe(key);
  });

  it('refuses an object larger than the ceiling for its purpose', async () => {
    const user = await registered();
    const key = await slot(user);
    uploadFinished(key, 9 * 1024 * 1024);

    const res = await request(app)
      .patch('/v1/auth/profile')
      .set(auth(user))
      .send({ avatarKey: key })
      .expect(413);
    expect(res.body.error.code).toBe('UPLOAD_TOO_LARGE');
  });

  it('no longer accepts a URL from the client at all', async () => {
    const user = await registered();
    // The old field. Unknown keys are rejected by .strict() validation, which
    // is what stops this quietly becoming a second way in.
    await request(app)
      .patch('/v1/auth/profile')
      .set(auth(user))
      .send({ avatarUrl: 'https://evil.example/tracker.gif' })
      .expect(422);
  });
});
