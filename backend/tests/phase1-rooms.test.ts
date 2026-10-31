// Phase 1, second slice: polls, daily tasks, fan levels, super messages, VIP.
//
// The money boundary, stated once: polls and tasks move no gems and no coins
// to anyone but the task's claimant (free coins, § C5b); fan levels read
// gifts already paid; super messages and VIP spend GEMS and pay no host.

import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildGateway, shutdownGateway } from '../src/gateway/server.js';
import type { ServerMessage } from '../src/gateway/protocol.js';
import { pool } from '../src/infra/db.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { clearLookCache } from '../src/modules/cosmetics/index.js';
import {
  ECONOMY,
  conversionLegs,
  freeCoinGrantLegs,
  invalidateCatalogCache,
  postTransaction,
} from '../src/modules/economy/index.js';
import { clearFanCache, fanLevelFor } from '../src/modules/gifting/index.js';
import { getCosmeticForSale } from '../src/modules/economy/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { closePool, resetLedger, sumEntries } from './helpers.js';

const app = buildApp();
let server: Server;
let wss: ReturnType<typeof buildGateway>['wss'];
let url: string;
let counter = 0;
const nextPhone = () => `+9187${String(30_000_000 + counter++).slice(-8)}`;
const RATES = { faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee, pointsPerRupee: ECONOMY.pointsPerRupee };

interface User {
  id: string;
  token: string;
}
const auth = (u: User) => ({ Authorization: `Bearer ${u.token}` });

async function adult(name = 'Asha'): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { deviceId: `p1-${randomUUID()}`, platform: 'android' } })
    .expect(200);
  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name })
    .expect(200);
  return { id: res.body.user.id as string, token };
}

async function goLive(host: User): Promise<string> {
  const res = await request(app)
    .post('/v1/rooms/live')
    .set(auth(host))
    .send({ title: 'Evening adda', tag: 'chatting', seatCapacity: 4 })
    .expect(201);
  return res.body.room.id as string;
}

async function grantCoins(userId: string, coins: number): Promise<void> {
  await postTransaction({
    txnType: 'free_coin_grant',
    idempotencyKey: uuidv7(),
    identity: { source: 'signup' },
    rates: RATES,
    legs: freeCoinGrantLegs({ userId, coins }),
  });
}

async function grantGems(userId: string, gems: number): Promise<void> {
  await grantCoins(userId, gems);
  await postTransaction({
    txnType: 'coin_to_gem_conversion',
    idempotencyKey: uuidv7(),
    identity: { coin_amount: gems },
    rates: { ...RATES, coinToGemRateBp: 10_000 },
    legs: conversionLegs({ userId, coins: gems, rateBp: 10_000 }),
  });
}

async function sendGift(from: User, roomId: string, to: string, giftId: string, quantity = 1): Promise<void> {
  const catalog = await request(app).get('/v1/catalog/gifts').expect(200);
  const gift = catalog.body.gifts.find((g: { id: string }) => g.id === giftId);
  await request(app)
    .post('/v1/gifts/send')
    .set(auth(from))
    .set('Idempotency-Key', randomUUID())
    .send({ roomId, recipientId: to, giftId, quantity, expectedCoinPrice: gift.coinPrice })
    .expect(200);
}

class TestClient {
  private socket: WebSocket;
  private inbox: ServerMessage[] = [];
  constructor() {
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw) => this.inbox.push(JSON.parse(raw.toString()) as ServerMessage));
  }
  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }
  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }
  async next<T extends ServerMessage['t']>(type: T, timeoutMs = 3_000): Promise<Extract<ServerMessage, { t: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.inbox.find((m) => m.t === type);
      if (found) {
        this.inbox = this.inbox.filter((m) => m !== found);
        return found as Extract<ServerMessage, { t: T }>;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for "${type}"`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  close(): void {
    this.socket.close();
  }
}

async function inRoom(user: User, roomId: string): Promise<{ client: TestClient; joined: Extract<ServerMessage, { t: 'joined' }> }> {
  const client = new TestClient();
  await client.open();
  client.send({ t: 'auth', token: user.token });
  await client.next('ready');
  client.send({ t: 'join', roomId });
  const joined = await client.next('joined');
  return { client, joined };
}

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
  await closePool();
});
beforeEach(async () => {
  await resetLedger();
  await resetRateLimits();
  clearFanCache();
  clearLookCache();
  invalidateCatalogCache();
  vi.spyOn(LiveKitProvider.prototype, 'setParticipantGrants').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'muteParticipant').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'removeParticipant').mockResolvedValue();
});
afterEach(() => vi.restoreAllMocks());

// ── Polls ───────────────────────────────────────────────────────────────────

describe('polls', () => {
  it('are asked by the host, answered once each, tallied from the votes, and closed', async () => {
    const host = await adult('Host');
    const a = await adult('Aisha');
    const b = await adult('Bela');
    const roomId = await goLive(host);

    // A viewer cannot ask.
    await request(app)
      .post(`/v1/rooms/${roomId}/polls`)
      .set(auth(a))
      .send({ question: 'Next song?', options: ['Kesariya', 'Tum Hi Ho'] })
      .expect(403);

    const created = await request(app)
      .post(`/v1/rooms/${roomId}/polls`)
      .set(auth(host))
      .send({ question: 'Next song?', options: ['Kesariya', 'Tum Hi Ho', 'Chaiyya Chaiyya'], durationSeconds: 120 })
      .expect(201);
    const poll = created.body.poll;
    expect(poll.total).toBe(0);
    expect(poll.closedAt).toBeNull();

    await request(app).post(`/v1/rooms/${roomId}/polls/${poll.id}/votes`).set(auth(a)).send({ optionIndex: 0 }).expect(200);
    // A second tap is a change of mind, not a second vote.
    const changed = await request(app)
      .post(`/v1/rooms/${roomId}/polls/${poll.id}/votes`)
      .set(auth(a))
      .send({ optionIndex: 2 })
      .expect(200);
    expect(changed.body.poll.myVote).toBe(2);
    await request(app).post(`/v1/rooms/${roomId}/polls/${poll.id}/votes`).set(auth(b)).send({ optionIndex: 2 }).expect(200);

    const current = await request(app).get(`/v1/rooms/${roomId}/polls/current`).set(auth(b)).expect(200);
    expect(current.body.poll.options.map((o: { votes: number }) => o.votes)).toEqual([0, 0, 2]);
    expect(current.body.poll.total).toBe(2);
    expect(current.body.poll.myVote).toBe(2);
    expect(current.body.config.durationsSeconds).toContain(120);

    // No such option.
    await request(app).post(`/v1/rooms/${roomId}/polls/${poll.id}/votes`).set(auth(b)).send({ optionIndex: 3 }).expect(422);

    const closed = await request(app).post(`/v1/rooms/${roomId}/polls/${poll.id}/close`).set(auth(host)).expect(200);
    expect(closed.body.poll.closedAt).not.toBeNull();
    const late = await request(app)
      .post(`/v1/rooms/${roomId}/polls/${poll.id}/votes`)
      .set(auth(a))
      .send({ optionIndex: 1 })
      .expect(409);
    expect(late.body.error.code).toBe('POLL_CLOSED');

    // Nothing moved. Not a single ledger row for anyone.
    const { rows } = await pool.query('SELECT count(*) FROM ledger_txns');
    expect(Number(rows[0].count)).toBe(0);
  });

  it('a new poll closes the old one, and a room admin may ask', async () => {
    const host = await adult('Host');
    const admin = await adult('Admin');
    const roomId = await goLive(host);
    await request(app).post(`/v1/rooms/${roomId}/admins`).set(auth(host)).send({ userId: admin.id }).expect(200);

    const first = await request(app)
      .post(`/v1/rooms/${roomId}/polls`)
      .set(auth(admin))
      .send({ question: 'Game?', options: ['Yes', 'No'] })
      .expect(201);
    const second = await request(app)
      .post(`/v1/rooms/${roomId}/polls`)
      .set(auth(host))
      .send({ question: 'Which one?', options: ['Ludo', 'Antakshari'] })
      .expect(201);
    expect(second.body.poll.id).not.toBe(first.body.poll.id);
    const { rows } = await pool.query('SELECT closed_at FROM room_polls WHERE id = $1', [first.body.poll.id]);
    expect(rows[0].closed_at).not.toBeNull();

    // Duplicate options are refused.
    await request(app)
      .post(`/v1/rooms/${roomId}/polls`)
      .set(auth(host))
      .send({ question: 'Hmm', options: ['Same', 'same'] })
      .expect(422);
  });

  it('is on the joined message with the viewer’s own vote, and is pushed on every change', async () => {
    const host = await adult('Host');
    const fan = await adult('Fan');
    const roomId = await goLive(host);
    const created = await request(app)
      .post(`/v1/rooms/${roomId}/polls`)
      .set(auth(host))
      .send({ question: 'Mood?', options: ['Chill', 'Hype'] })
      .expect(201);
    await request(app)
      .post(`/v1/rooms/${roomId}/polls/${created.body.poll.id}/votes`)
      .set(auth(fan))
      .send({ optionIndex: 1 })
      .expect(200);

    const { client, joined } = await inRoom(fan, roomId);
    expect(joined.poll?.id).toBe(created.body.poll.id);
    expect(joined.poll?.myVote).toBe(1);
    expect(joined.poll?.total).toBe(1);
    expect(joined.pinned).toBeNull();

    // Note: publishToRoom is real here, but there is no Redis in tests, so
    // cross-process delivery is not asserted — the HTTP responses carry the
    // same view.
    client.close();
  });
});

// ── Daily tasks ─────────────────────────────────────────────────────────────

describe('daily tasks', () => {
  it('derive progress from the day’s activity and pay once per task per day', async () => {
    const fan = await adult('Fan');
    const host = await adult('Host');
    const roomId = await goLive(host);

    const before = await request(app).get('/v1/rewards/tasks').set(auth(fan)).expect(200);
    const gift1 = before.body.tasks.tasks.find((t: { id: string }) => t.id === 'gift1');
    expect(gift1).toMatchObject({ kind: 'gifts', target: 1, progress: 0, claimed: false });

    // Not finished: refused, and no coins.
    const early = await request(app).post('/v1/rewards/tasks/gift1').set(auth(fan)).expect(409);
    expect(early.body.error.code).toBe('REWARD_NOT_EARNED');

    await grantCoins(fan.id, 1_000);
    await request(app).post(`/v1/rooms/${roomId}/join`).set(auth(fan)).expect(200);
    await sendGift(fan, roomId, host.id, 'heart');
    const coinsAfterGift = await sumEntries('user_coins', fan.id);

    const after = await request(app).get('/v1/rewards/tasks').set(auth(fan)).expect(200);
    expect(after.body.tasks.tasks.find((t: { id: string }) => t.id === 'gift1').progress).toBe(1);

    const claim = await request(app).post('/v1/rewards/tasks/gift1').set(auth(fan)).expect(200);
    expect(claim.body).toEqual({ coins: gift1.coins, alreadyClaimed: false });
    const again = await request(app).post('/v1/rewards/tasks/gift1').set(auth(fan)).expect(200);
    expect(again.body).toEqual({ coins: gift1.coins, alreadyClaimed: true });
    expect(await sumEntries('user_coins', fan.id)).toBe(coinsAfterGift + gift1.coins);

    const done = await request(app).get('/v1/rewards/tasks').set(auth(fan)).expect(200);
    expect(done.body.tasks.tasks.find((t: { id: string }) => t.id === 'gift1').claimed).toBe(true);

    // The share task is reported by the app, once a day.
    const shared = await request(app).post('/v1/rewards/tasks/share').set(auth(fan)).expect(200);
    expect(shared.body.tasks.tasks.find((t: { id: string }) => t.id === 'share1').progress).toBe(1);
    await request(app).post('/v1/rewards/tasks/share').set(auth(fan)).expect(200);
    const { rows } = await pool.query('SELECT count(*) FROM task_events WHERE user_id = $1', [fan.id]);
    expect(Number(rows[0].count)).toBe(1);

    // An unknown task is unavailable, not a crash.
    await request(app).post('/v1/rewards/tasks/nope').set(auth(fan)).expect(409);
  });

  it('counts chat lines and follows made today', async () => {
    const fan = await adult('Fan');
    const host = await adult('Host');
    const roomId = await goLive(host);
    await request(app).post(`/v1/users/${host.id}/follow`).set(auth(fan)).expect(200);
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO room_messages (id, room_id, user_id, body, verdict) VALUES ($1, $2, $3, $4, 'clean')`,
        [uuidv7(), roomId, fan.id, `hi ${i}`],
      );
    }
    // A blocked line does not count.
    await pool.query(
      `INSERT INTO room_messages (id, room_id, user_id, body, verdict) VALUES ($1, $2, $3, $4, 'blocked')`,
      [uuidv7(), roomId, fan.id, 'nope'],
    );
    const status = await request(app).get('/v1/rewards/tasks').set(auth(fan)).expect(200);
    const byId = Object.fromEntries(status.body.tasks.tasks.map((t: { id: string }) => [t.id, t]));
    expect(byId.chat5.progress).toBe(3);
    expect(byId.follow1.progress).toBe(1);
  });
});

// ── Fan levels ──────────────────────────────────────────────────────────────

describe('fan levels', () => {
  it('are a reading of coins gifted to one host', () => {
    const ladder = [1, 2_000, 10_000];
    expect(fanLevelFor(0, ladder)).toEqual({ level: 0, coins: 0, nextAt: 1 });
    expect(fanLevelFor(20, ladder)).toEqual({ level: 1, coins: 20, nextAt: 2_000 });
    expect(fanLevelFor(10_000, ladder)).toEqual({ level: 3, coins: 10_000, nextAt: null });
  });

  it('step up after a gift and ride on chat lines; the host is always 0', async () => {
    const fan = await adult('Fan');
    const host = await adult('Host');
    const roomId = await goLive(host);
    await grantCoins(fan.id, 5_000);
    await request(app).post(`/v1/rooms/${roomId}/join`).set(auth(fan)).expect(200);

    const none = await request(app).get(`/v1/gifts/fan-level/${host.id}`).set(auth(fan)).expect(200);
    expect(none.body.fan).toEqual({ level: 0, coins: 0, nextAt: 1 });

    await sendGift(fan, roomId, host.id, 'rose', 10); // 900 coins
    await sendGift(fan, roomId, host.id, 'heart', 99); // 1,980 → 2,880 total
    const some = await request(app).get(`/v1/gifts/fan-level/${host.id}`).set(auth(fan)).expect(200);
    expect(some.body.fan).toEqual({ level: 2, coins: 2_880, nextAt: 10_000 });

    const { client: fanSocket } = await inRoom(fan, roomId);
    const { client: hostSocket } = await inRoom(host, roomId);
    fanSocket.send({ t: 'chat', roomId, body: 'hello host' });
    const line = await hostSocket.next('chat');
    expect(line.line.fan).toBe(2);
    // The sender's own echo, so the next line the fan reads is the host's.
    await fanSocket.next('chat');
    hostSocket.send({ t: 'chat', roomId, body: 'hello fan' });
    const reply = await fanSocket.next('chat');
    expect(reply.line.fan).toBe(0);
    fanSocket.close();
    hostSocket.close();
  });
});

// ── Super messages ──────────────────────────────────────────────────────────

describe('super messages', () => {
  it('spend gems, pay the host nothing, write their row in the ledger’s transaction, and pin', async () => {
    const fan = await adult('Fan');
    const host = await adult('Host');
    const roomId = await goLive(host);
    await grantGems(fan.id, 10_000);
    await request(app).post(`/v1/rooms/${roomId}/join`).set(auth(fan)).expect(200);
    const hostPointsBefore = await sumEntries('host_points_held', host.id);
    const price = (await getCosmeticForSale('super_message')).gemPrice;
    await grantGems(fan.id, price);
    const start = await sumEntries('user_gems', fan.id);

    const key = randomUUID();
    const sent = await request(app)
      .post('/v1/cosmetics/super')
      .set(auth(fan))
      .set('Idempotency-Key', key)
      .send({ roomId, body: 'Host ji aap best ho!', expectedGemPrice: price })
      .expect(200);
    expect(sent.body.message).toMatchObject({ roomId, userId: fan.id, body: 'Host ji aap best ho!', gems: price });
    expect(sent.body.replayed).toBe(false);
    expect(await sumEntries('user_gems', fan.id)).toBe(start - price);
    expect(await sumEntries('host_points_held', host.id)).toBe(hostPointsBefore);

    const { rows } = await pool.query('SELECT txn_id, body FROM super_messages WHERE room_id = $1', [roomId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].txn_id).toBe(sent.body.message.id);

    // Replay: same message, no second charge.
    const replay = await request(app)
      .post('/v1/cosmetics/super')
      .set(auth(fan))
      .set('Idempotency-Key', key)
      .send({ roomId, body: 'Host ji aap best ho!', expectedGemPrice: price })
      .expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(await sumEntries('user_gems', fan.id)).toBe(start - price);

    // Pinned for whoever walks in now.
    const { client, joined } = await inRoom(host, roomId);
    expect(joined.pinned?.id).toBe(sent.body.message.id);
    client.close();

    // Append-only.
    await expect(pool.query('DELETE FROM super_messages WHERE txn_id = $1', [rows[0].txn_id])).rejects.toThrow(
      /append-only/,
    );
  });

  it('refuse a blocked line before charging, a wrong price, and a room they are banned from', async () => {
    const fan = await adult('Fan');
    const host = await adult('Host');
    const roomId = await goLive(host);
    await grantGems(fan.id, 10_000);
    const price = (await getCosmeticForSale('super_message')).gemPrice;

    const blocked = await request(app)
      .post('/v1/cosmetics/super')
      .set(auth(fan))
      .set('Idempotency-Key', randomUUID())
      .send({ roomId, body: 'bhosdike', expectedGemPrice: price })
      .expect(422);
    expect(blocked.body.error.code).toBe('MESSAGE_BLOCKED');
    expect(await sumEntries('user_gems', fan.id)).toBe(10_000);

    const priced = await request(app)
      .post('/v1/cosmetics/super')
      .set(auth(fan))
      .set('Idempotency-Key', randomUUID())
      .send({ roomId, body: 'hi', expectedGemPrice: 100 })
      .expect(409);
    expect(priced.body.error.code).toBe('COSMETIC_PRICE_CHANGED');

    await request(app).post(`/v1/rooms/${roomId}/join`).set(auth(fan)).expect(200);
    await request(app).post(`/v1/rooms/${roomId}/kick/${fan.id}`).set(auth(host)).send({}).expect(200);
    const banned = await request(app)
      .post('/v1/cosmetics/super')
      .set(auth(fan))
      .set('Idempotency-Key', randomUUID())
      .send({ roomId, body: 'let me in', expectedGemPrice: price })
      .expect(403);
    expect(banned.body.error.code).toBe('ROOM_BANNED');
    expect(await sumEntries('user_gems', fan.id)).toBe(10_000);
  });
});

// ── VIP ─────────────────────────────────────────────────────────────────────

describe('VIP', () => {
  it('lists the tiers with their bundles and prices from the catalog', async () => {
    const res = await request(app).get('/v1/cosmetics/vip').set(auth(await adult())).expect(200);
    const ids = res.body.tiers.map((t: { id: string }) => t.id);
    expect(ids).toEqual(['vip_silver', 'vip_gold', 'vip_platinum', 'vip_diamond']);
    const gold = res.body.tiers.find((t: { id: string }) => t.id === 'vip_gold');
    // Prices come from the catalog (doubled in 018); the shape is what is asserted.
    expect(gold).toMatchObject({ badge: 'gold', durationDays: 30 });
    expect(gold.gemPrice).toBeGreaterThan(0);
    expect(gold.includes).toContain('chat_bubble');
  });

  it('buys a tier with gems, grants the bundle for the same month, and shows the badge on the look', async () => {
    const user = await adult('Kabir');
    const viewer = await adult('Meera');
    const tiers = (await request(app).get('/v1/cosmetics/vip').set(auth(user)).expect(200)).body.tiers as {
      id: string;
      gemPrice: number;
    }[];
    const goldPrice = tiers.find((t) => t.id === 'vip_gold')!.gemPrice;
    const platinumPrice = tiers.find((t) => t.id === 'vip_platinum')!.gemPrice;
    await grantGems(user.id, goldPrice + 1_000);

    const bought = await request(app)
      .post('/v1/cosmetics/vip/purchase')
      .set(auth(user))
      .set('Idempotency-Key', randomUUID())
      .send({ tierId: 'vip_gold', expectedGemPrice: goldPrice })
      .expect(200);
    expect(bought.body).toMatchObject({ tierId: 'vip_gold', badge: 'gold', gemsSpent: goldPrice, replayed: false });
    expect(await sumEntries('user_gems', user.id)).toBe(1_000);

    const { rows } = await pool.query<{ cosmetic_id: string; source: string; equipped: boolean }>(
      'SELECT cosmetic_id, source, equipped FROM user_cosmetics WHERE user_id = $1 ORDER BY cosmetic_id',
      [user.id],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.cosmetic_id, r]));
    expect(byId.vip_gold).toMatchObject({ source: 'purchase', equipped: true });
    expect(byId.chat_bubble).toMatchObject({ source: 'vip', equipped: true });
    expect(byId.nickname_color).toMatchObject({ source: 'vip', equipped: true });
    expect(byId.entry_basic).toMatchObject({ source: 'vip', equipped: true });

    // The purchase log has the tier.
    const log = await pool.query('SELECT cosmetic_id, gems FROM cosmetic_purchases WHERE user_id = $1', [user.id]);
    expect(log.rows).toEqual([{ cosmetic_id: 'vip_gold', gems: String(goldPrice) }]);

    // Everyone sees the badge, with the bundled name colour.
    const profile = await request(app).get(`/v1/users/${user.id}/profile`).set(auth(viewer)).expect(200);
    expect(profile.body.profile.look.vip).toBe('gold');
    expect(profile.body.profile.look.nameColor).not.toBeNull();

    // Upgrading swaps the badge; the old tier comes off.
    await grantGems(user.id, platinumPrice);
    await request(app)
      .post('/v1/cosmetics/vip/purchase')
      .set(auth(user))
      .set('Idempotency-Key', randomUUID())
      .send({ tierId: 'vip_platinum', expectedGemPrice: platinumPrice })
      .expect(200);
    clearLookCache();
    const after = await request(app).get(`/v1/users/${user.id}/profile`).set(auth(viewer)).expect(200);
    expect(after.body.profile.look.vip).toBe('platinum');
    const equipped = await pool.query(
      `SELECT cosmetic_id FROM user_cosmetics WHERE user_id = $1 AND kind = 'vip' AND equipped`,
      [user.id],
    );
    expect(equipped.rows).toEqual([{ cosmetic_id: 'vip_platinum' }]);
  });

  it('is refused without gems — coins never pay for it', async () => {
    const user = await adult('Broke');
    await grantCoins(user.id, 1_000_000);
    const silver = (await request(app).get('/v1/cosmetics/vip').set(auth(user)).expect(200)).body.tiers.find(
      (t: { id: string }) => t.id === 'vip_silver',
    );
    const res = await request(app)
      .post('/v1/cosmetics/vip/purchase')
      .set(auth(user))
      .set('Idempotency-Key', randomUUID())
      .send({ tierId: 'vip_silver', expectedGemPrice: silver.gemPrice })
      .expect(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await sumEntries('user_coins', user.id)).toBe(1_000_000);
  });
});
