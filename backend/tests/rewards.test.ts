import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildGateway, shutdownGateway, tickWatchRewards } from '../src/gateway/server.js';
import type { ServerMessage } from '../src/gateway/protocol.js';
import { pool } from '../src/infra/db.js';
import { invalidateCatalogCache } from '../src/modules/economy/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { claimCheckin, grantWatchReward, istDate } from '../src/modules/rewards/index.js';
import { consumeEvents } from '../src/workers/consumers.js';
import type { OutboxEventRecord } from '../src/workers/publisher.js';
import { balanceDrift, closePool, resetLedger, sumEntries, systemBalance } from './helpers.js';

vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return { ...actual, publishToRoom: () => undefined };
});

const app = buildApp();
let phoneCounter = 0;
const nextPhone = () => `+9194${String(50_000_000 + phoneCounter++).slice(-8)}`;

interface User {
  id: string;
  token: string;
  deviceId: string;
}

async function registered(name = 'Asha', deviceId = `rw-${randomUUID()}`): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { deviceId, platform: 'android' } })
    .expect(200);
  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name })
    .expect(200);
  return { id: res.body.user.id as string, token, deviceId };
}

const auth = (user: User) => ({ Authorization: `Bearer ${user.token}` });

/** A claim on an earlier IST day, as a real one made then would have been. */
function daysAgo(n: number): string {
  return istDate(new Date(Date.now() - n * 86_400_000));
}

function purchaseEvent(userId: string, amountPaise: number): OutboxEventRecord {
  return {
    id: 1,
    eventId: randomUUID(),
    eventType: 'purchase_completed',
    partitionKey: userId,
    payload: { user_id: userId, amount_paise: amountPaise },
    txnId: null,
    createdAt: new Date(),
  };
}

beforeEach(async () => {
  await resetLedger();
  invalidateCatalogCache();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await closePool();
});

describe('the welcome bonus', () => {
  it('pays 1,000 coins once, as ordinary giftable coins', async () => {
    const user = await registered();

    const first = await request(app).post('/v1/rewards/welcome').set(auth(user)).expect(200);
    expect(first.body).toEqual({ coins: 1_000, alreadyClaimed: false });

    const again = await request(app).post('/v1/rewards/welcome').set(auth(user)).expect(200);
    expect(again.body).toEqual({ coins: 1_000, alreadyClaimed: true });

    expect(await sumEntries('user_coins', user.id)).toBe(1_000);
    // The cost lands where the ≤8% budget check reads it: ₹7.69 of face value.
    expect(await systemBalance('expense_free_coins')).toBe(769);
    expect(await balanceDrift()).toEqual([]);
  });

  it('pays once per PHONE, however many accounts sign up on it', async () => {
    const shared = `shared-${randomUUID()}`;
    const first = await registered('Asha', shared);
    const second = await registered('Asha2', shared);

    await request(app).post('/v1/rewards/welcome').set(auth(first)).expect(200);
    const res = await request(app).post('/v1/rewards/welcome').set(auth(second)).expect(409);

    expect(res.body.error.code).toBe('WELCOME_ALREADY_USED_ON_DEVICE');
    expect(await sumEntries('user_coins', second.id)).toBe(0);

    const status = await request(app).get('/v1/rewards').set(auth(second)).expect(200);
    expect(status.body.rewards.welcome).toMatchObject({ claimed: false, available: false });
  });

  it('is not for guests', async () => {
    const guest = await request(app)
      .post('/v1/auth/guest')
      .send({ device: { deviceId: `g-${randomUUID()}`, platform: 'android' } })
      .expect(201);

    const res = await request(app)
      .post('/v1/rewards/welcome')
      .set('Authorization', `Bearer ${guest.body.accessToken}`)
      .expect(403);
    expect(res.body.error.code).toBe('REGISTRATION_REQUIRED');
  });
});

describe('the daily check-in', () => {
  it('pays today once, whatever is asked', async () => {
    const user = await registered();

    const first = await request(app).post('/v1/rewards/checkin').set(auth(user)).expect(200);
    const second = await request(app).post('/v1/rewards/checkin').set(auth(user)).expect(200);

    expect(first.body).toEqual({ coins: 40, streakDay: 1, alreadyClaimed: false });
    expect(second.body).toEqual({ coins: 40, streakDay: 1, alreadyClaimed: true });
    expect(await sumEntries('user_coins', user.id)).toBe(40);
  });

  it('climbs the ladder on consecutive days, and wraps after day 7', async () => {
    const user = await registered();
    const ladder = [40, 60, 80, 120, 160, 200, 300, 40];

    for (let offset = 7; offset >= 0; offset--) {
      const result = await claimCheckin(user.id, daysAgo(offset));
      expect(result.coins).toBe(ladder[7 - offset]);
    }
    expect(await sumEntries('user_coins', user.id)).toBe(1_000);
  });

  it('starts over at day 1 after a missed day', async () => {
    const user = await registered();
    await claimCheckin(user.id, daysAgo(3));
    await claimCheckin(user.id, daysAgo(2));
    // Yesterday missed.
    const today = await claimCheckin(user.id, daysAgo(0));

    expect(today).toMatchObject({ streakDay: 1, coins: 40 });
  });

  it('pays one claim when two arrive at once', async () => {
    const user = await registered();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post('/v1/rewards/checkin').set(auth(user))),
    );

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await sumEntries('user_coins', user.id)).toBe(40);
  });

  it('reports today’s state', async () => {
    const user = await registered();
    await claimCheckin(user.id, daysAgo(1));

    const before = await request(app).get('/v1/rewards').set(auth(user)).expect(200);
    expect(before.body.rewards.checkin).toEqual({
      ladder: [40, 60, 80, 120, 160, 200, 300],
      claimedToday: false,
      streakDay: 2,
    });

    await request(app).post('/v1/rewards/checkin').set(auth(user)).expect(200);
    const after = await request(app).get('/v1/rewards').set(auth(user)).expect(200);
    expect(after.body.rewards.checkin).toMatchObject({ claimedToday: true, streakDay: 2 });
  });
});

describe('the watch reward', () => {
  it('pays 60 coins an interval, ten times a day and no more', async () => {
    const user = await registered();

    for (let i = 1; i <= 10; i++) {
      expect(await grantWatchReward(user.id)).toEqual({ coins: 60, earnedToday: i, dailyCap: 10 });
    }
    expect(await grantWatchReward(user.id)).toBeNull();
    expect(await sumEntries('user_coins', user.id)).toBe(600);
  });

  it('pays a racing pair for one slot only once', async () => {
    const user = await registered();
    const results = await Promise.all([grantWatchReward(user.id), grantWatchReward(user.id)]);

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await sumEntries('user_coins', user.id)).toBe(60);
  });

  describe('measured by the gateway', () => {
    let server: Server;
    let wss: ReturnType<typeof buildGateway>['wss'];
    let url: string;

    beforeAll(async () => {
      const built = buildGateway();
      server = built.server;
      wss = built.wss;
      await new Promise<void>((resolve) => server.listen(0, resolve));
      url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
    });

    afterAll(async () => {
      await shutdownGateway(wss);
      server.close();
    });

    async function inRoom(token: string, roomId: string) {
      const socket = new WebSocket(url);
      const inbox: ServerMessage[] = [];
      socket.on('message', (raw) => inbox.push(JSON.parse(raw.toString()) as ServerMessage));
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      const next = async <T extends ServerMessage['t']>(type: T, timeoutMs = 2_000) => {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const index = inbox.findIndex((m) => m.t === type);
          if (index >= 0) return inbox.splice(index, 1)[0] as Extract<ServerMessage, { t: T }>;
          if (Date.now() > deadline) return null;
          await new Promise((r) => setTimeout(r, 25));
        }
      };
      socket.send(JSON.stringify({ t: 'auth', token }));
      await next('ready');
      socket.send(JSON.stringify({ t: 'join', roomId }));
      await next('joined');
      return { socket, next };
    }

    it('pays a viewer who stays five minutes, and never the host', async () => {
      const host = await registered('Host');
      const viewer = await registered('Viewer');
      const live = await request(app)
        .post('/v1/rooms/live')
        .set(auth(host))
        .send({ title: 'Watch me', tag: 'chatting' })
        .expect(201);
      const roomId = live.body.room.id as string;

      const hostSocket = await inRoom(host.token, roomId);
      const viewerSocket = await inRoom(viewer.token, roomId);

      // Five minutes, a minute at a time — a single jump is capped, so a
      // stalled process cannot hand out a whole interval on waking.
      let now = Date.now();
      for (let minute = 1; minute <= 5; minute++) {
        now += 60_000;
        await tickWatchRewards(now);
      }

      const reward = await viewerSocket.next('reward');
      expect(reward).toEqual({ t: 'reward', kind: 'watch', coins: 60, earnedToday: 1, dailyCap: 10 });
      expect(await sumEntries('user_coins', viewer.id)).toBe(60);

      expect(await hostSocket.next('reward', 300)).toBeNull();
      expect(await sumEntries('user_coins', host.id)).toBe(0);

      hostSocket.socket.close();
      viewerSocket.socket.close();
    });

    it('does not pay a stalled process all at once', async () => {
      const host = await registered('Host');
      const viewer = await registered('Viewer');
      const live = await request(app)
        .post('/v1/rooms/live')
        .set(auth(host))
        .send({ title: 'Sleepy', tag: 'chatting' })
        .expect(201);

      const viewerSocket = await inRoom(viewer.token, live.body.room.id);
      await tickWatchRewards(Date.now() + 60 * 60_000);

      expect(await viewerSocket.next('reward', 300)).toBeNull();
      viewerSocket.socket.close();
    });
  });
});

describe('referrals', () => {
  async function referralCode(user: User): Promise<string> {
    const status = await request(app).get('/v1/rewards').set(auth(user)).expect(200);
    return status.body.rewards.referral.code as string;
  }

  it('pays the referrer 4,000 coins on the friend’s first real purchase — once', async () => {
    const referrer = await registered('Kabir');
    const friend = await registered('Meera');
    const code = await referralCode(referrer);

    const attached = await request(app)
      .post('/v1/rewards/referral')
      .set(auth(friend))
      .send({ code })
      .expect(200);
    expect(attached.body).toEqual({ referrerName: 'Kabir' });

    // The ₹19 starter pack does not qualify — it would buy ₹31 of referral coins.
    await consumeEvents([purchaseEvent(friend.id, 1_900)]);
    expect(await sumEntries('user_coins', referrer.id)).toBe(0);

    await consumeEvents([purchaseEvent(friend.id, 29_900)]);
    await consumeEvents([purchaseEvent(friend.id, 99_900)]);
    expect(await sumEntries('user_coins', referrer.id)).toBe(4_000);

    const status = await request(app).get('/v1/rewards').set(auth(referrer)).expect(200);
    expect(status.body.rewards.referral).toMatchObject({ invited: 1, rewarded: 1 });
  });

  it('refuses your own code, a second code, and a code that does not exist', async () => {
    const user = await registered('Asha');
    const other = await registered('Rohan');

    const own = await request(app)
      .post('/v1/rewards/referral')
      .set(auth(user))
      .send({ code: await referralCode(user) })
      .expect(422);
    expect(own.body.error.code).toBe('REFERRAL_SELF');

    const missing = await request(app)
      .post('/v1/rewards/referral')
      .set(auth(user))
      .send({ code: '99999999999' })
      .expect(404);
    expect(missing.body.error.code).toBe('REFERRAL_CODE_INVALID');

    await request(app)
      .post('/v1/rewards/referral')
      .set(auth(user))
      .send({ code: await referralCode(other) })
      .expect(200);
    const second = await request(app)
      .post('/v1/rewards/referral')
      .set(auth(user))
      .send({ code: await referralCode(other) })
      .expect(409);
    expect(second.body.error.code).toBe('REFERRAL_ALREADY_SET');
  });

  it('refuses an invite between two accounts on one phone', async () => {
    const phone = `family-${randomUUID()}`;
    const referrer = await registered('Parent', phone);
    const friend = await registered('Child', phone);

    const res = await request(app)
      .post('/v1/rewards/referral')
      .set(auth(friend))
      .send({ code: await referralCode(referrer) })
      .expect(422);
    expect(res.body.error.code).toBe('REFERRAL_NOT_ALLOWED');
  });

  it('only lets new accounts enter a code', async () => {
    const referrer = await registered('Kabir');
    const old = await registered('Old');
    await pool.query("UPDATE users SET created_at = now() - interval '30 days' WHERE id = $1", [old.id]);

    const res = await request(app)
      .post('/v1/rewards/referral')
      .set(auth(old))
      .send({ code: await referralCode(referrer) })
      .expect(409);
    expect(res.body.error.code).toBe('REFERRAL_WINDOW_CLOSED');
  });
});

describe('the dials', () => {
  it('pays what config says, so free-coin cost can be cut without a release', async () => {
    await pool.query(
      `UPDATE app_config SET value = jsonb_set(value, '{signup}', '250') WHERE key = 'free_coins'`,
    );
    invalidateCatalogCache();
    try {
      const user = await registered();
      const res = await request(app).post('/v1/rewards/welcome').set(auth(user)).expect(200);
      expect(res.body.coins).toBe(250);
    } finally {
      await pool.query(
        `UPDATE app_config SET value = jsonb_set(value, '{signup}', '1000') WHERE key = 'free_coins'`,
      );
      invalidateCatalogCache();
    }
  });

  it('stops every claim at the free_coin_grant kill switch', async () => {
    const user = await registered();
    await pool.query("UPDATE ledger_txn_types SET is_active = false WHERE code = 'free_coin_grant'");
    try {
      const res = await request(app).post('/v1/rewards/checkin').set(auth(user)).expect(503);
      expect(res.body.error.code).toBe('TXN_TYPE_INACTIVE');
      expect(await sumEntries('user_coins', user.id)).toBe(0);
    } finally {
      await pool.query("UPDATE ledger_txn_types SET is_active = true WHERE code = 'free_coin_grant'");
    }
  });
});
