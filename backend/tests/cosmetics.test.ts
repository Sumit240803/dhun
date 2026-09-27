import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import WebSocket from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { buildGateway, resetEntranceCooldowns, shutdownGateway } from '../src/gateway/server.js';
import type { ServerMessage } from '../src/gateway/protocol.js';
import { pool } from '../src/infra/db.js';
import { clearLookCache } from '../src/modules/cosmetics/index.js';
import {
  conversionLegs,
  ECONOMY,
  freeCoinGrantLegs,
  invalidateCatalogCache,
  postTransaction,
} from '../src/modules/economy/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { spendMix } from '../src/workers/jobs/metrics.js';
import { runReconciliation } from '../src/workers/jobs/reconciliation.js';
import {
  balanceDrift,
  closePool,
  resetLedger,
  sumEntries,
  systemBalance,
  unbalancedTxns,
} from './helpers.js';

vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return { ...actual, publishToRoom: () => undefined };
});

const app = buildApp();
const DEVICE = { deviceId: 'cos-device-0001', platform: 'android' };
const DAY_MS = 86_400_000;

let phoneCounter = 0;
const nextPhone = () => `+9195${String(40_000_000 + phoneCounter++).slice(-8)}`;

interface User {
  id: string;
  token: string;
}

async function adult(name = 'Asha'): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { ...DEVICE, deviceId: `cd-${phone}` } })
    .expect(200);
  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name })
    .expect(200);
  return { id: res.body.user.id as string, token };
}

const RATES = {
  faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
  pointsPerRupee: ECONOMY.pointsPerRupee,
};

/** Gems, the way a user gets them: coins, converted. At par, to keep the arithmetic readable. */
async function grantGems(userId: string, gems: number): Promise<void> {
  await postTransaction({
    txnType: 'free_coin_grant',
    idempotencyKey: uuidv7(),
    identity: { source: 'signup' },
    rates: RATES,
    legs: freeCoinGrantLegs({ userId, coins: gems }),
  });
  await postTransaction({
    txnType: 'coin_to_gem_conversion',
    idempotencyKey: uuidv7(),
    identity: { coin_amount: gems },
    rates: { ...RATES, coinToGemRateBp: 10_000 },
    legs: conversionLegs({ userId, coins: gems, rateBp: 10_000 }),
  });
}

function buy(user: User, cosmeticId: string, expectedGemPrice: number, key = randomUUID()) {
  return request(app)
    .post('/v1/cosmetics/purchase')
    .set('Authorization', `Bearer ${user.token}`)
    .set('Idempotency-Key', key)
    .send({ cosmeticId, expectedGemPrice });
}

function mine(user: User) {
  return request(app).get('/v1/cosmetics/mine').set('Authorization', `Bearer ${user.token}`);
}

/** Moves an owned item's expiry, as time passing would. */
async function setExpiry(userId: string, cosmeticId: string, at: Date): Promise<void> {
  await pool.query(
    'UPDATE user_cosmetics SET expires_at = $3 WHERE user_id = $1 AND cosmetic_id = $2',
    [userId, cosmeticId, at],
  );
  clearLookCache();
}

function daysFromNow(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / DAY_MS;
}

beforeEach(async () => {
  await resetLedger();
  invalidateCatalogCache();
  clearLookCache();
  vi.spyOn(LiveKitProvider.prototype, 'setParticipantGrants').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await closePool();
});

describe('buying a cosmetic', () => {
  it('spends gems, books cosmetics revenue, pays no host anything, and equips it', async () => {
    const user = await adult();
    await grantGems(user.id, 10_000);

    const res = await buy(user, 'frame_basic', 6_500).expect(200);

    expect(res.body.gemsSpent).toBe(6_500);
    expect(res.body.balance.gems).toBe(3_500);
    expect(res.body.replayed).toBe(false);
    expect(res.body.item).toMatchObject({
      cosmeticId: 'frame_basic',
      kind: 'frame',
      active: true,
      equipped: true,
    });
    expect(daysFromNow(res.body.item.expiresAt)).toBeCloseTo(30, 0);

    expect(await sumEntries('user_gems', user.id)).toBe(3_500);
    expect(await sumEntries('user_coins', user.id)).toBe(0);
    // ₹50 of face value, all of it revenue — the zero-payout path.
    expect(await systemBalance('revenue_cosmetics')).toBe(-5_000);
    expect(await systemBalance('system_point_float')).toBe(0);

    const record = await pool.query(
      'SELECT gems, duration_days FROM cosmetic_purchases WHERE user_id = $1',
      [user.id],
    );
    expect(record.rows).toEqual([{ gems: '6500', duration_days: 30 }]);

    expect(await unbalancedTxns()).toEqual([]);
    expect(await balanceDrift()).toEqual([]);
  });

  it('adds time to an item that is still active, rather than starting over', async () => {
    // Extending early must never throw away days already paid for.
    const user = await adult();
    await grantGems(user.id, 20_000);

    await buy(user, 'frame_basic', 6_500).expect(200);
    const second = await buy(user, 'frame_basic', 6_500).expect(200);

    expect(daysFromNow(second.body.item.expiresAt)).toBeCloseTo(60, 0);
  });

  it('starts again from now when the item has already lapsed', async () => {
    const user = await adult();
    await grantGems(user.id, 20_000);

    await buy(user, 'frame_basic', 6_500).expect(200);
    await setExpiry(user.id, 'frame_basic', new Date(Date.now() - 10 * DAY_MS));

    const renewed = await buy(user, 'frame_basic', 6_500).expect(200);
    expect(daysFromNow(renewed.body.item.expiresAt)).toBeCloseTo(30, 0);
  });

  it('wears one item per kind — a new frame takes the old one off', async () => {
    const user = await adult();
    await grantGems(user.id, 20_000);

    await buy(user, 'frame_basic', 6_500).expect(200);
    await buy(user, 'frame_rose', 6_500).expect(200);
    // A different kind is worn alongside.
    await buy(user, 'nickname_teal', 2_600).expect(200);

    const items = (await mine(user).expect(200)).body.items as Array<{
      cosmeticId: string;
      equipped: boolean;
    }>;
    const equipped = items.filter((i) => i.equipped).map((i) => i.cosmeticId).sort();
    expect(equipped).toEqual(['frame_rose', 'nickname_teal']);
  });

  it('refuses a purchase the gems do not cover, and grants nothing', async () => {
    const user = await adult();
    await grantGems(user.id, 2_000);

    const res = await buy(user, 'frame_basic', 6_500).expect(402);

    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect((await mine(user).expect(200)).body.items).toEqual([]);
  });

  it('never spends coins, however many there are', async () => {
    // Coins pay hosts; gems do not. A purchase falling back to coins would
    // quietly move money onto the payout path.
    const user = await adult();
    await postTransaction({
      txnType: 'free_coin_grant',
      idempotencyKey: uuidv7(),
      identity: { source: 'signup' },
      rates: RATES,
      legs: freeCoinGrantLegs({ userId: user.id, coins: 100_000 }),
    });

    await buy(user, 'frame_basic', 6_500).expect(402);
    expect(await sumEntries('user_coins', user.id)).toBe(100_000);
  });

  it('refuses a price the user never saw', async () => {
    const user = await adult();
    await grantGems(user.id, 10_000);

    const res = await buy(user, 'frame_basic', 6_000).expect(409);
    expect(res.body.error.code).toBe('COSMETIC_PRICE_CHANGED');
    expect(res.body.error.details).toEqual({ gemPrice: 6_500 });
  });

  it('does not sell what M7 does not ship — VIP, super messages, or nothing at all', async () => {
    const user = await adult();
    await grantGems(user.id, 1_000_000);

    for (const [id, price] of [
      ['vip_gold', 65_000],
      ['super_message', 10_400],
      ['no_such_item', 100],
    ] as const) {
      const res = await buy(user, id, price).expect(404);
      expect(res.body.error.code).toBe('COSMETIC_NOT_FOUND');
    }
  });

  it('refuses a guest, and a request without an Idempotency-Key', async () => {
    const guest = await request(app)
      .post('/v1/auth/guest')
      .send({ device: { ...DEVICE, deviceId: `cguest-${Date.now()}` } })
      .expect(201);
    const asGuest = await buy(
      { id: guest.body.user.id, token: guest.body.accessToken },
      'frame_basic',
      6_500,
    ).expect(403);
    expect(asGuest.body.error.code).toBe('REGISTRATION_REQUIRED');

    const user = await adult();
    const noKey = await request(app)
      .post('/v1/cosmetics/purchase')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ cosmeticId: 'frame_basic', expectedGemPrice: 6_500 })
      .expect(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('retries', () => {
  it('replays the same purchase for the same key, and charges once', async () => {
    const user = await adult();
    await grantGems(user.id, 20_000);
    const key = randomUUID();

    await buy(user, 'frame_basic', 6_500, key).expect(200);
    const again = await buy(user, 'frame_basic', 6_500, key).expect(200);

    expect(again.body.replayed).toBe(true);
    expect(again.body.balance.gems).toBe(13_500);
    expect(daysFromNow(again.body.item.expiresAt)).toBeCloseTo(30, 0);
  });

  it('replays even after the item is repriced', async () => {
    const user = await adult();
    await grantGems(user.id, 20_000);
    const key = randomUUID();

    await buy(user, 'frame_basic', 6_500, key).expect(200);
    await pool.query("UPDATE cosmetics SET gem_price = 8000 WHERE id = 'frame_basic'");
    try {
      const again = await buy(user, 'frame_basic', 6_500, key).expect(200);
      expect(again.body.replayed).toBe(true);
    } finally {
      await pool.query("UPDATE cosmetics SET gem_price = 6500 WHERE id = 'frame_basic'");
    }
  });

  it('refuses a key reused for a different item, or by a different account', async () => {
    const user = await adult();
    const other = await adult('Rohan');
    await grantGems(user.id, 20_000);
    await grantGems(other.id, 20_000);
    const key = randomUUID();

    await buy(user, 'frame_basic', 6_500, key).expect(200);

    const differentItem = await buy(user, 'frame_rose', 6_500, key).expect(422);
    expect(differentItem.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Replaying someone else's key would describe THEIR purchase to a stranger.
    const differentUser = await buy(other, 'frame_basic', 6_500, key).expect(422);
    expect(differentUser.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('wearing', () => {
  it('equips something owned, and takes a kind off', async () => {
    const user = await adult();
    await grantGems(user.id, 20_000);
    await buy(user, 'frame_basic', 6_500).expect(200);
    await buy(user, 'frame_rose', 6_500).expect(200);

    const equipped = await request(app)
      .post('/v1/cosmetics/equip')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ cosmeticId: 'frame_basic' })
      .expect(200);
    const worn = (equipped.body.items as Array<{ cosmeticId: string; equipped: boolean }>)
      .filter((i) => i.equipped)
      .map((i) => i.cosmeticId);
    expect(worn).toEqual(['frame_basic']);

    const off = await request(app)
      .post('/v1/cosmetics/unequip')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ kind: 'frame' })
      .expect(200);
    expect((off.body.items as Array<{ equipped: boolean }>).some((i) => i.equipped)).toBe(false);
  });

  it('refuses to equip what is not owned, or has expired', async () => {
    const user = await adult();
    await grantGems(user.id, 10_000);

    const notOwned = await request(app)
      .post('/v1/cosmetics/equip')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ cosmeticId: 'frame_rose' })
      .expect(404);
    expect(notOwned.body.error.code).toBe('COSMETIC_NOT_OWNED');

    await buy(user, 'frame_basic', 6_500).expect(200);
    await setExpiry(user.id, 'frame_basic', new Date(Date.now() - 1_000));

    const expired = await request(app)
      .post('/v1/cosmetics/equip')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ cosmeticId: 'frame_basic' })
      .expect(410);
    expect(expired.body.error.code).toBe('COSMETIC_EXPIRED');
  });

  it('lists a lapsed item as inactive and not worn, so it can be renewed', async () => {
    const user = await adult();
    await grantGems(user.id, 10_000);
    await buy(user, 'frame_basic', 6_500).expect(200);
    await setExpiry(user.id, 'frame_basic', new Date(Date.now() - 1_000));

    const items = (await mine(user).expect(200)).body.items;
    expect(items).toEqual([
      expect.objectContaining({ cosmeticId: 'frame_basic', active: false, equipped: false }),
    ]);
  });
});

describe('the catalog', () => {
  it('carries art, validated style and the conversion terms — and nothing unsellable', async () => {
    const res = await request(app).get('/v1/catalog/cosmetics').expect(200);

    const kinds = new Set((res.body.cosmetics as Array<{ kind: string }>).map((c) => c.kind));
    expect([...kinds].sort()).toEqual(['chat_bubble', 'entry_effect', 'frame', 'nickname_color']);

    const frame = (res.body.cosmetics as Array<Record<string, unknown>>).find(
      (c) => c.id === 'frame_basic',
    );
    expect(frame).toMatchObject({
      asset: 'placeholder/frames/frame_basic.v1.webp',
      style: { light: { ring: '#D97706' }, dark: { ring: '#FBBF24' } },
      gemPrice: 6_500,
      durationDays: 30,
    });

    expect(res.body.conversion).toEqual({ coinToGemRateBp: 12_000, minimumCoins: 200 });
  });

  it('withholds an item whose style is broken, rather than selling a blank', async () => {
    await pool.query(
      `UPDATE cosmetics SET style = '{"light":{"color":"red"},"dark":{"color":"blue"}}'
        WHERE id = 'nickname_rose'`,
    );
    invalidateCatalogCache();
    try {
      const res = await request(app).get('/v1/catalog/cosmetics').expect(200);
      const ids = (res.body.cosmetics as Array<{ id: string }>).map((c) => c.id);
      expect(ids).not.toContain('nickname_rose');
      expect(ids).toContain('nickname_teal');
    } finally {
      await pool.query(
        `UPDATE cosmetics SET style = '{"light":{"color":"#BE185D"},"dark":{"color":"#F9A8D4"}}'
          WHERE id = 'nickname_rose'`,
      );
      invalidateCatalogCache();
    }
  });
});

describe('looks — how people appear to everyone else', () => {
  it('draws a frame on a seat, and stops the moment it expires', async () => {
    const host = await adult('Host');
    await grantGems(host.id, 10_000);
    await buy(host, 'frame_ocean', 6_500).expect(200);

    const live = await request(app)
      .post('/v1/rooms/live')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Look room', tag: 'chatting', seatCapacity: 4 })
      .expect(201);
    const roomId = live.body.room.id as string;

    const viewer = await adult('Viewer');
    const joined = await request(app)
      .post(`/v1/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);
    expect(joined.body.seats[0].look.frame).toEqual({
      asset: 'placeholder/frames/frame_ocean.v1.webp',
      style: { light: { ring: '#0284C7' }, dark: { ring: '#38BDF8' } },
    });

    await setExpiry(host.id, 'frame_ocean', new Date(Date.now() - 1_000));
    const later = await request(app)
      .post(`/v1/rooms/${roomId}/join`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);
    expect(later.body.seats[0].look).toEqual({
      frame: null,
      bubble: null,
      nameColor: null,
      entry: null,
    });
  });

  it('shows on a public profile and on the owner’s own summary', async () => {
    const user = await adult('Kabir');
    const viewer = await adult('Meera');
    await grantGems(user.id, 10_000);
    await buy(user, 'nickname_teal', 2_600).expect(200);

    const profile = await request(app)
      .get(`/v1/users/${user.id}/profile`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);
    expect(profile.body.profile.look.nameColor).toEqual({
      light: { color: '#0F766E' },
      dark: { color: '#5EEAD4' },
    });

    const summary = await request(app)
      .get('/v1/users/me/summary')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect(summary.body.summary.look.nameColor).toEqual({
      light: { color: '#0F766E' },
      dark: { color: '#5EEAD4' },
    });
  });

  it('puts the sender’s frame on their gift', async () => {
    const host = await adult('Host');
    const sender = await adult('Asha');
    await grantGems(sender.id, 10_000);
    await buy(sender, 'frame_rose', 6_500).expect(200);
    await postTransaction({
      txnType: 'free_coin_grant',
      idempotencyKey: uuidv7(),
      identity: { source: 'signup' },
      rates: RATES,
      legs: freeCoinGrantLegs({ userId: sender.id, coins: 200 }),
    });

    const live = await request(app)
      .post('/v1/rooms/live')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Gift room', tag: 'chatting' })
      .expect(201);

    const res = await request(app)
      .post('/v1/gifts/send')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomId: live.body.room.id,
        recipientId: host.id,
        giftId: 'rose',
        quantity: 1,
        expectedCoinPrice: 90,
      })
      .expect(200);

    expect(res.body.gift.senderFrame).toEqual({
      asset: 'placeholder/frames/frame_rose.v1.webp',
      style: { light: { ring: '#DB2777' }, dark: { ring: '#F472B6' } },
    });
  });
});

describe('in a live room, over the gateway', () => {
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

  beforeEach(() => resetEntranceCooldowns());

  /** A socket that collects everything, joined to a room. */
  async function inRoom(token: string, roomId: string) {
    const socket = new WebSocket(url);
    const inbox: ServerMessage[] = [];
    socket.on('message', (raw) => inbox.push(JSON.parse(raw.toString()) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });

    const next = async <T extends ServerMessage['t']>(type: T, timeoutMs = 3_000) => {
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

  async function room(host: User): Promise<string> {
    const live = await request(app)
      .post('/v1/rooms/live')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Gateway looks', tag: 'chatting' })
      .expect(201);
    return live.body.room.id as string;
  }

  it('announces an entrance for someone wearing an entry effect — once, not per reconnect', async () => {
    const host = await adult('Host');
    const vip = await adult('Zoya');
    await grantGems(vip.id, 20_000);
    await buy(vip, 'entry_basic', 13_000).expect(200);
    const roomId = await room(host);

    const watcher = await inRoom(host.token, roomId);

    const first = await inRoom(vip.token, roomId);
    const entry = await watcher.next('entry');
    expect(entry?.user).toMatchObject({ userId: vip.id, name: 'Zoya' });
    expect(entry?.user.look.entry?.asset).toBe('placeholder/entry/entry_basic.v1.json');

    // A reconnect is a fresh join. It must not replay the effect to the room.
    first.socket.close();
    const again = await inRoom(vip.token, roomId);
    expect(await watcher.next('entry', 600)).toBeNull();

    again.socket.close();
    watcher.socket.close();
  });

  it('does not announce someone without an entry effect', async () => {
    const host = await adult('Host');
    const plain = await adult('Rohan');
    const roomId = await room(host);

    const watcher = await inRoom(host.token, roomId);
    const arrival = await inRoom(plain.token, roomId);

    expect(await watcher.next('entry', 600)).toBeNull();
    arrival.socket.close();
    watcher.socket.close();
  });

  it('carries the sender’s bubble and name colour on a chat line', async () => {
    const host = await adult('Host');
    const talker = await adult('Meera');
    await grantGems(talker.id, 20_000);
    await buy(talker, 'bubble_night', 3_900).expect(200);
    await buy(talker, 'nickname_rose', 2_600).expect(200);
    const roomId = await room(host);

    const watcher = await inRoom(host.token, roomId);
    const speaker = await inRoom(talker.token, roomId);
    speaker.socket.send(JSON.stringify({ t: 'chat', roomId, body: 'namaste' }));

    const line = await watcher.next('chat');
    expect(line?.line.look.bubble).toEqual({
      light: { background: '#E0E7FF', border: '#6366F1', text: '#312E81' },
      dark: { background: '#312E81', border: '#818CF8', text: '#E0E7FF' },
    });
    expect(line?.line.look.nameColor).toEqual({
      light: { color: '#BE185D' },
      dark: { color: '#F9A8D4' },
    });

    speaker.socket.close();
    watcher.socket.close();
  });
});

describe('measuring and reconciling', () => {
  it('finds every purchase recorded and matching the ledger', async () => {
    const user = await adult();
    await grantGems(user.id, 10_000);
    await buy(user, 'frame_basic', 6_500).expect(200);

    const outcomes = await runReconciliation();
    expect(outcomes.find((o) => o.name === 'cosmetic_purchases_match_ledger')?.status).toBe('pass');
  });

  it('reports the cosmetics share of spend for a day', async () => {
    const user = await adult();
    const host = await adult('Host');
    await grantGems(user.id, 6_500);
    await buy(user, 'frame_basic', 6_500).expect(200); // ₹50 of cosmetics

    await postTransaction({
      txnType: 'free_coin_grant',
      idempotencyKey: uuidv7(),
      identity: { source: 'signup' },
      rates: RATES,
      legs: freeCoinGrantLegs({ userId: user.id, coins: 19_500 }),
    });
    const live = await request(app)
      .post('/v1/rooms/live')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ title: 'Mix', tag: 'chatting' })
      .expect(201);
    await pool.query("UPDATE gift_catalog SET coin_price = 19500 WHERE id = 'yacht'");
    try {
      await request(app)
        .post('/v1/gifts/send')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', randomUUID())
        .send({
          roomId: live.body.room.id,
          recipientId: host.id,
          giftId: 'yacht',
          quantity: 1,
          expectedCoinPrice: 19_500,
        })
        .expect(200); // ₹150 of gifting
    } finally {
      await pool.query("UPDATE gift_catalog SET coin_price = 31000 WHERE id = 'yacht'");
    }

    const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const mix = await spendMix(today);

    expect(mix).toEqual({
      day: today,
      giftingPaise: 15_000,
      cosmeticsPaise: 5_000,
      cosmeticsShareBp: 2_500,
    });
  });
});
