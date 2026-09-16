import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { invalidateCatalogCache } from '../src/modules/economy/index.js';
import {
  ConsolePushProvider,
  notifyFollowersLive,
  setPushProvider,
} from '../src/modules/notifications/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { closePool, resetLedger } from './helpers.js';

vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return { ...actual, publishToRoom: () => undefined };
});

const app = buildApp();
let phoneCounter = 0;
const nextPhone = () => `+9193${String(60_000_000 + phoneCounter++).slice(-8)}`;

interface User {
  id: string;
  token: string;
  deviceId: string;
  publicId: string;
}

async function registered(name: string, locale?: string): Promise<User> {
  const phone = nextPhone();
  const deviceId = `ds-${randomUUID()}`;
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { deviceId, platform: 'android' } })
    .expect(200);
  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name, ...(locale ? { locale } : {}) })
    .expect(200);
  const { rows } = await pool.query<{ public_id: string }>('SELECT public_id FROM users WHERE id = $1', [
    res.body.user.id,
  ]);
  return { id: res.body.user.id as string, token, deviceId, publicId: String(rows[0].public_id) };
}

const auth = (user: User) => ({ Authorization: `Bearer ${user.token}` });

async function goLive(host: User, title = 'Evening adda', party = false): Promise<string> {
  const res = await request(app)
    .post('/v1/rooms/live')
    .set(auth(host))
    .send({ title, tag: 'chatting', ...(party ? { seatCapacity: 4 } : {}) })
    .expect(201);
  return res.body.room.id as string;
}

async function setViewers(roomId: string, count: number): Promise<void> {
  await pool.query('UPDATE rooms SET viewer_count = $2 WHERE id = $1', [roomId, count]);
}

async function setColdStart(patch: Record<string, unknown>): Promise<void> {
  await pool.query(`UPDATE app_config SET value = value || $1::jsonb WHERE key = 'cold_start'`, [
    JSON.stringify(patch),
  ]);
  invalidateCatalogCache();
}

async function token(user: User, value = `ExponentPushToken[${randomUUID().slice(0, 22)}]`) {
  await request(app)
    .post('/v1/notifications/token')
    .set(auth(user))
    .send({ deviceId: user.deviceId, token: value })
    .expect(200);
  return value;
}

let push: ConsolePushProvider;

beforeEach(async () => {
  await resetLedger();
  invalidateCatalogCache();
  push = new ConsolePushProvider();
  setPushProvider(push);
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await setColdStart({ maxFeedRooms: 4, hideViewerCounts: true, dropNewUsersIntoRoom: true });
});

afterAll(async () => {
  await closePool();
});

describe('search', () => {
  it('finds people by the start of their name, case-insensitively', async () => {
    const searcher = await registered('Searcher');
    await registered('Priya Sharma');
    await registered('priyanka');
    await registered('Supriya');

    const res = await request(app)
      .get('/v1/discover/search')
      .query({ q: 'PRIY' })
      .set(auth(searcher))
      .expect(200);

    const names = (res.body.people as Array<{ displayName: string }>).map((p) => p.displayName);
    // A prefix, not a contains-match — "Supriya" is not someone typing "priy" means.
    expect(names.sort()).toEqual(['Priya Sharma', 'priyanka']);
  });

  it('finds someone by the public ID a host reads out on stream', async () => {
    const host = await registered('Zoya');
    const res = await request(app).get('/v1/discover/search').query({ q: host.publicId }).expect(200);

    expect(res.body.people[0]).toMatchObject({ userId: host.id, displayName: 'Zoya' });
  });

  it('shows who is live, and opens their room', async () => {
    const host = await registered('Kabir');
    const roomId = await goLive(host, 'Late night songs');

    const res = await request(app).get('/v1/discover/search').query({ q: 'kab' }).expect(200);
    expect(res.body.people[0].liveRoomId).toBe(roomId);

    const byTitle = await request(app).get('/v1/discover/search').query({ q: 'night' }).expect(200);
    expect(byTitle.body.rooms).toEqual([
      expect.objectContaining({ id: roomId, title: 'Late night songs', hostName: 'Kabir' }),
    ]);
  });

  it('hides people across a block, in both directions', async () => {
    const searcher = await registered('Searcher');
    const blocked = await registered('Blocked Person');
    await pool.query('INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)', [
      blocked.id,
      searcher.id,
    ]);

    const res = await request(app)
      .get('/v1/discover/search')
      .query({ q: 'blocked' })
      .set(auth(searcher))
      .expect(200);
    expect(res.body.people).toEqual([]);
  });

  it('treats LIKE wildcards as the characters they are', async () => {
    await registered('Anyone');
    const res = await request(app).get('/v1/discover/search').query({ q: '%' }).expect(200);
    expect(res.body.people).toEqual([]);
  });
});

describe('cold start', () => {
  it('shows a few full rooms rather than many thin ones', async () => {
    const hosts = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F'].map((n) => registered(`Host ${n}`)));
    const rooms = [];
    for (const [index, host] of hosts.entries()) {
      const roomId = await goLive(host);
      await setViewers(roomId, index * 10);
      rooms.push(roomId);
    }

    const res = await request(app).get('/v1/rooms/feed').query({ category: 'explore' }).expect(200);
    expect(res.body.rooms).toHaveLength(4);
    // The fullest four.
    expect(res.body.rooms.map((r: { id: string }) => r.id)).toEqual(rooms.slice(2).reverse());
    // And the next page is empty, rather than the thin rooms by the back door.
    const page2 = await request(app)
      .get('/v1/rooms/feed')
      .query({ category: 'explore', offset: 4 })
      .expect(200);
    expect(page2.body.rooms).toEqual([]);
  });

  it('hides viewer counts, and shows them again when the dial is lifted', async () => {
    const host = await registered('Host');
    const roomId = await goLive(host);
    await setViewers(roomId, 3);

    const hidden = await request(app).get('/v1/rooms/feed').expect(200);
    expect(hidden.body.rooms[0].viewers).toBeNull();

    await setColdStart({ hideViewerCounts: false, maxFeedRooms: null });
    const shown = await request(app).get('/v1/rooms/feed').expect(200);
    expect(shown.body.rooms[0].viewers).toBe(3);
  });

  it('never caps the Following tab — a followed host is always findable', async () => {
    const viewer = await registered('Viewer');
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      const host = await registered(`Followed ${name}`);
      await pool.query('INSERT INTO follows (follower_user_id, followee_user_id) VALUES ($1, $2)', [
        viewer.id,
        host.id,
      ]);
      await goLive(host);
    }

    const res = await request(app)
      .get('/v1/rooms/feed')
      .query({ category: 'following' })
      .set(auth(viewer))
      .expect(200);
    expect(res.body.rooms).toHaveLength(5);
  });

  it('drops a new user into the fullest room — never their own', async () => {
    const quiet = await registered('Quiet');
    const busy = await registered('Busy');
    const newcomer = await registered('Newcomer');
    await setViewers(await goLive(quiet), 2);
    const busyRoom = await goLive(busy, 'Packed', true);
    await setViewers(busyRoom, 40);

    const res = await request(app).get('/v1/rooms/fullest').set(auth(newcomer)).expect(200);
    expect(res.body.room.id).toBe(busyRoom);

    const asHost = await request(app).get('/v1/rooms/fullest').set(auth(busy)).expect(200);
    expect(asHost.body.room.id).not.toBe(busyRoom);
  });

  it('tells the app the rules through its launch config', async () => {
    const res = await request(app).get('/v1/config/app').expect(200);
    expect(res.body.config.coldStart).toEqual({
      maxFeedRooms: 4,
      hideViewerCounts: true,
      peakStartIst: '20:00',
      peakEndIst: '23:00',
      dropNewUsersIntoRoom: true,
    });
  });
});

describe('push tokens', () => {
  it('accepts an Expo token for this device, and refuses anything else', async () => {
    const user = await registered('Asha');
    await token(user);

    const bad = await request(app)
      .post('/v1/notifications/token')
      .set(auth(user))
      .send({ deviceId: user.deviceId, token: 'not-a-token' })
      .expect(422);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');

    const otherDevice = await request(app)
      .post('/v1/notifications/token')
      .set(auth(user))
      .send({ deviceId: 'someone-elses-phone', token: 'ExponentPushToken[abcdefghijklmnop]' })
      .expect(404);
    expect(otherDevice.body.error.code).toBe('DEVICE_NOT_FOUND');
  });

  it('moves a token to whoever signed in on the phone last', async () => {
    // The previous account's notifications must not keep arriving on a phone
    // someone else is now using.
    const first = await registered('First');
    const second = await registered('Second');
    const shared = await token(first);
    await pool.query('UPDATE user_devices SET push_token = NULL WHERE user_id = $1', [second.id]);

    await token(second, shared);

    const { rows } = await pool.query('SELECT user_id FROM user_devices WHERE push_token = $1', [shared]);
    expect(rows).toEqual([{ user_id: second.id }]);
  });
});

describe('telling followers a host is live', () => {
  async function scene() {
    const host = await registered('Priya');
    const fan = await registered('Fan', 'en-IN');
    const hindiFan = await registered('Hindi Fan', 'hi-IN');
    for (const follower of [fan, hindiFan]) {
      await pool.query('INSERT INTO follows (follower_user_id, followee_user_id) VALUES ($1, $2)', [
        follower.id,
        host.id,
      ]);
      await token(follower);
    }
    return { host, fan, hindiFan };
  }

  it('writes the event in the same transaction as the room', async () => {
    const host = await registered('Host');
    const roomId = await goLive(host, 'Sunday songs');

    const { rows } = await pool.query(
      "SELECT payload FROM outbox WHERE event_type = 'room_started' AND partition_key = $1",
      [roomId],
    );
    expect(rows).toEqual([
      { payload: { room_id: roomId, host_id: host.id, title: 'Sunday songs', party: false } },
    ]);
  });

  it('notifies each follower once, in their own language', async () => {
    const { host } = await scene();
    const roomId = await goLive(host, 'Sunday songs');

    const sent = await notifyFollowersLive({ roomId, hostId: host.id, title: 'Sunday songs' });
    expect(sent).toBe(2);
    expect(push.sent.map((m) => m.title).sort()).toEqual(['Priya is live now', 'Priya अभी लाइव हैं']);
    expect(push.sent[0].data).toEqual({ type: 'room_live', roomId });

    // The outbox delivers at least once. A retry sends nothing new.
    expect(await notifyFollowersLive({ roomId, hostId: host.id, title: 'Sunday songs' })).toBe(0);
    expect(push.sent).toHaveLength(2);
  });

  it('does not buzz followers again when a host restarts within the cooldown', async () => {
    const { host } = await scene();
    const first = await goLive(host);
    await notifyFollowersLive({ roomId: first, hostId: host.id, title: 'One' });
    await request(app).post(`/v1/rooms/${first}/end`).set(auth(host)).expect(200);

    const second = await goLive(host);
    expect(await notifyFollowersLive({ roomId: second, hostId: host.id, title: 'Two' })).toBe(0);
  });

  it('skips a room that ended before the event was processed', async () => {
    const { host } = await scene();
    const roomId = await goLive(host);
    await request(app).post(`/v1/rooms/${roomId}/end`).set(auth(host)).expect(200);

    expect(await notifyFollowersLive({ roomId, hostId: host.id, title: 'Gone' })).toBe(0);
    expect(push.sent).toEqual([]);
  });

  it('never notifies across a block', async () => {
    const { host, fan } = await scene();
    await pool.query('INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)', [
      fan.id,
      host.id,
    ]);
    const roomId = await goLive(host);

    expect(await notifyFollowersLive({ roomId, hostId: host.id, title: 'x' })).toBe(1);
  });

  it('clears a token the push service says is dead', async () => {
    const { host, fan } = await scene();
    setPushProvider({
      name: 'dead-for-fan',
      async send(messages) {
        return messages.map(() => ({ ok: false, unregistered: true }) as const);
      },
    });
    const roomId = await goLive(host);
    await notifyFollowersLive({ roomId, hostId: host.id, title: 'x' });

    const { rows } = await pool.query(
      'SELECT push_token FROM user_devices WHERE user_id = $1',
      [fan.id],
    );
    expect(rows.every((row) => row.push_token === null)).toBe(true);
  });
});
