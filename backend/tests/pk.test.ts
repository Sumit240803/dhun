import { randomUUID } from 'crypto';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import {
  ECONOMY,
  freeCoinGrantLegs,
  invalidateCatalogCache,
  postTransaction,
} from '../src/modules/economy/index.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { matchPkQueue, settleDuePkBattles } from '../src/modules/games/index.js';
import { balanceDrift, closePool, resetLedger, unbalancedTxns } from './helpers.js';

const published = vi.hoisted(() => [] as Array<{ roomId: string; message: { t?: string } }>);
vi.mock('../src/infra/roomBus.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/infra/roomBus.js')>();
  return {
    ...actual,
    publishToRoom: (roomId: string, message: unknown) => {
      published.push({ roomId, message: message as { t?: string } });
    },
  };
});

const app = buildApp();
const DEVICE = { deviceId: 'pk-device-0001', platform: 'android' };

let phoneCounter = 0;
const nextPhone = () => `+9197${String(40_000_000 + phoneCounter++).slice(-8)}`;

interface User {
  id: string;
  token: string;
}

async function adult(name = 'Host'): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({ phone, code: otp.body.devCode, device: { ...DEVICE, deviceId: `pd-${phone}` } })
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
    .set('Authorization', `Bearer ${host.token}`)
    .send({ title: 'Evening adda', tag: 'chatting' })
    .expect(201);
  return res.body.room.id as string;
}

async function grantCoins(userId: string, coins: number): Promise<void> {
  await postTransaction({
    txnType: 'free_coin_grant',
    idempotencyKey: uuidv7(),
    identity: { source: 'signup' },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
    },
    legs: freeCoinGrantLegs({ userId, coins }),
  });
}

function gift(sender: User, roomId: string, recipientId: string, quantity = 1) {
  return request(app)
    .post('/v1/gifts/send')
    .set('Authorization', `Bearer ${sender.token}`)
    .set('Idempotency-Key', randomUUID())
    .send({ roomId, recipientId, giftId: 'rose', quantity, expectedCoinPrice: 90 });
}

/** Two hosts, both live, mid-battle. */
async function battle(): Promise<{
  home: User;
  away: User;
  homeRoom: string;
  awayRoom: string;
  battleId: string;
}> {
  const home = await adult('Meera');
  const away = await adult('Rohan');
  const homeRoom = await goLive(home);
  const awayRoom = await goLive(away);

  const invite = await request(app)
    .post('/v1/pk/invites')
    .set('Authorization', `Bearer ${home.token}`)
    .send({ toUserId: away.id })
    .expect(201);

  const accepted = await request(app)
    .post(`/v1/pk/invites/${invite.body.inviteId}/accept`)
    .set('Authorization', `Bearer ${away.token}`)
    .send({})
    .expect(200);

  return { home, away, homeRoom, awayRoom, battleId: accepted.body.pk.id as string };
}

/** Closes the window so the sweep will settle it. */
async function endWindow(battleId: string): Promise<void> {
  // `now()`, not `now() - 1s`: the sweep's condition is `ends_at <= now()`,
  // which is already true on the next statement, and subtracting a second
  // would push the window's end BEFORE the gifts this test just sent.
  await pool.query('UPDATE pk_battles SET ends_at = now() WHERE id = $1', [battleId]);
}

beforeEach(async () => {
  await resetLedger();
  invalidateCatalogCache();
  published.length = 0;
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
  vi.spyOn(LiveKitProvider.prototype, 'mintJoinToken').mockReturnValue({
    token: 'test-token',
    url: 'wss://test',
    roomName: 'test',
    identity: 'test',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

afterEach(() => vi.restoreAllMocks());
afterAll(closePool);

describe('starting a battle', () => {
  it('pairs two live hosts through an invitation', async () => {
    const { battleId, home, away } = await battle();

    const detail = await request(app)
      .get(`/v1/pk/battles/${battleId}`)
      .set('Authorization', `Bearer ${home.token}`)
      .expect(200);

    expect(detail.body.pk.phase).toBe('live');
    expect(detail.body.pk.sides.map((s: { userId: string }) => s.userId)).toEqual([home.id, away.id]);
    // Both start at zero: gifts received BEFORE the bar appeared must not
    // count, or one side gets a head start nobody could see being earned.
    expect(detail.body.pk.sides[0].score).toBe(0);
    expect(detail.body.pk.sides[1].score).toBe(0);
  });

  it('announces the battle to BOTH rooms', async () => {
    // The whole mechanic: each audience must see the other side's number move.
    const { homeRoom, awayRoom } = await battle();
    const started = published.filter((p) => p.message.t === 'pk:started');
    expect(started.map((p) => p.roomId).sort()).toEqual([homeRoom, awayRoom].sort());
  });

  it('refuses a host who is not live', async () => {
    const home = await adult('Meera');
    const away = await adult('Rohan');
    await goLive(home);
    // `away` never went live.

    const res = await request(app)
      .post('/v1/pk/invites')
      .set('Authorization', `Bearer ${home.token}`)
      .send({ toUserId: away.id })
      .expect(409);

    expect(res.body.error.code).toBe('NOT_LIVE');
  });

  it('refuses a second battle for a host already in one', async () => {
    const { away } = await battle();
    const third = await adult('Priya');
    await goLive(third);

    const res = await request(app)
      .post('/v1/pk/invites')
      .set('Authorization', `Bearer ${third.token}`)
      .send({ toUserId: away.id })
      .expect(409);

    expect(res.body.error.code).toBe('PK_ALREADY_IN_BATTLE');
  });

  it('settles a race between two accepted invitations with exactly one battle', async () => {
    // The unique indexes are what actually enforce this — the service's check
    // is there to produce a sentence, and two accepts in the same millisecond
    // both pass it.
    const home = await adult('Meera');
    const a = await adult('Rohan');
    const b = await adult('Priya');
    await goLive(home);
    await goLive(a);
    await goLive(b);

    const first = await request(app)
      .post('/v1/pk/invites')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ toUserId: home.id })
      .expect(201);
    const second = await request(app)
      .post('/v1/pk/invites')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ toUserId: home.id })
      .expect(201);

    const results = await Promise.all([
      request(app)
        .post(`/v1/pk/invites/${first.body.inviteId}/accept`)
        .set('Authorization', `Bearer ${home.token}`)
        .send({}),
      request(app)
        .post(`/v1/pk/invites/${second.body.inviteId}/accept`)
        .set('Authorization', `Bearer ${home.token}`)
        .send({}),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM pk_battles WHERE state = 'live'");
    expect(rows[0].n).toBe(1);
  });

  it('refuses a duplicate invitation to the same host', async () => {
    const home = await adult('Meera');
    const away = await adult('Rohan');
    await goLive(home);
    await goLive(away);

    await request(app)
      .post('/v1/pk/invites')
      .set('Authorization', `Bearer ${home.token}`)
      .send({ toUserId: away.id })
      .expect(201);

    const again = await request(app)
      .post('/v1/pk/invites')
      .set('Authorization', `Bearer ${home.token}`)
      .send({ toUserId: away.id })
      .expect(409);

    expect(again.body.error.code).toBe('PK_INVITE_PENDING');
  });
});

describe('scoring', () => {
  it('counts gifts sent to each host inside the window', async () => {
    const { home, away, homeRoom, awayRoom, battleId } = await battle();
    const fan = await adult('Asha');
    await grantCoins(fan.id, 50_000);

    await gift(fan, homeRoom, home.id, 10).expect(200); // 900 coins
    await gift(fan, awayRoom, away.id, 1).expect(200); //   90 coins

    const detail = await request(app)
      .get(`/v1/pk/battles/${battleId}`)
      .set('Authorization', `Bearer ${home.token}`)
      .expect(200);

    expect(detail.body.pk.sides[0].score).toBe(900);
    expect(detail.body.pk.sides[1].score).toBe(90);
  });

  it('ignores gifts sent before the battle started', async () => {
    const home = await adult('Meera');
    const away = await adult('Rohan');
    const homeRoom = await goLive(home);
    await goLive(away);

    const fan = await adult('Asha');
    await grantCoins(fan.id, 50_000);
    await gift(fan, homeRoom, home.id, 10).expect(200);

    const invite = await request(app)
      .post('/v1/pk/invites')
      .set('Authorization', `Bearer ${home.token}`)
      .send({ toUserId: away.id })
      .expect(201);
    const accepted = await request(app)
      .post(`/v1/pk/invites/${invite.body.inviteId}/accept`)
      .set('Authorization', `Bearer ${away.token}`)
      .send({})
      .expect(200);

    expect(accepted.body.pk.sides[0].score).toBe(0);
  });

  it('ranks the supporters under each side', async () => {
    const { home, homeRoom, battleId } = await battle();
    const big = await adult('Whale');
    const small = await adult('Minnow');
    await grantCoins(big.id, 100_000);
    await grantCoins(small.id, 100_000);

    await gift(big, homeRoom, home.id, 99).expect(200);
    await gift(small, homeRoom, home.id, 1).expect(200);

    const detail = await request(app)
      .get(`/v1/pk/battles/${battleId}`)
      .set('Authorization', `Bearer ${home.token}`)
      .expect(200);

    const supporters = detail.body.pk.sides[0].supporters as { userId: string }[];
    expect(supporters[0].userId).toBe(big.id);
    expect(supporters[1].userId).toBe(small.id);
  });
});

describe('settling', () => {
  it('names the winner and freezes the scores', async () => {
    const { home, homeRoom, battleId } = await battle();
    const fan = await adult('Asha');
    await grantCoins(fan.id, 50_000);
    await gift(fan, homeRoom, home.id, 10).expect(200);

    await endWindow(battleId);
    const { settled } = await settleDuePkBattles();
    expect(settled).toBe(1);

    const detail = await request(app)
      .get(`/v1/pk/battles/${battleId}`)
      .set('Authorization', `Bearer ${home.token}`)
      .expect(200);

    expect(detail.body.pk.phase).toBe('result');
    expect(detail.body.pk.winner).toBe(0);
    expect(detail.body.pk.sides[0].score).toBe(900);
  });

  it('calls a battle nobody gifted in a draw, not a loss for both', async () => {
    const { home, away, battleId } = await battle();
    await endWindow(battleId);
    await settleDuePkBattles();

    const { rows } = await pool.query<{ user_id: string; draws: number; losses: number }>(
      'SELECT user_id, draws, losses FROM pk_host_stats WHERE user_id = ANY($1::uuid[])',
      [[home.id, away.id]],
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.draws).toBe(1);
      expect(row.losses).toBe(0);
    }
  });

  it('is idempotent — a second sweep settles nothing', async () => {
    const { battleId } = await battle();
    await endWindow(battleId);

    expect((await settleDuePkBattles()).settled).toBe(1);
    expect((await settleDuePkBattles()).settled).toBe(0);
  });

  it('counts a win streak, and a loss resets it', async () => {
    const { home, away, homeRoom, awayRoom, battleId } = await battle();
    const fan = await adult('Asha');
    await grantCoins(fan.id, 200_000);

    await gift(fan, homeRoom, home.id, 10).expect(200);
    await endWindow(battleId);
    await settleDuePkBattles();

    // Round two, won by the other side.
    const second = await request(app)
      .post('/v1/pk/invites')
      .set('Authorization', `Bearer ${home.token}`)
      .send({ toUserId: away.id })
      .expect(201);
    const round2 = await request(app)
      .post(`/v1/pk/invites/${second.body.inviteId}/accept`)
      .set('Authorization', `Bearer ${away.token}`)
      .send({})
      .expect(200);

    await gift(fan, awayRoom, away.id, 10).expect(200);
    await endWindow(round2.body.pk.id);
    await settleDuePkBattles();

    const { rows } = await pool.query<{ user_id: string; streak: number; best_streak: number }>(
      'SELECT user_id, streak, best_streak FROM pk_host_stats WHERE user_id = ANY($1::uuid[])',
      [[home.id, away.id]],
    );
    const stats = new Map(rows.map((r) => [r.user_id, r]));
    expect(stats.get(home.id)!.streak).toBe(0);
    expect(stats.get(home.id)!.best_streak).toBe(1);
    expect(stats.get(away.id)!.streak).toBe(1);
  });

  it('settles the battle when a host ends their room', async () => {
    // Settled on the scores as they stand, not voided: the other side's
    // audience spent real money on a bar that was real while it moved.
    const { home, homeRoom, battleId } = await battle();
    const fan = await adult('Asha');
    await grantCoins(fan.id, 50_000);
    await gift(fan, homeRoom, home.id, 10).expect(200);

    await request(app)
      .post(`/v1/rooms/${homeRoom}/end`)
      .set('Authorization', `Bearer ${home.token}`)
      .expect(200);

    const { rows } = await pool.query<{ state: string; winner_user_id: string; home_score: string }>(
      'SELECT state, winner_user_id, home_score FROM pk_battles WHERE id = $1',
      [battleId],
    );
    expect(rows[0].state).toBe('cancelled');
    expect(rows[0].winner_user_id).toBe(home.id);
    expect(Number(rows[0].home_score)).toBe(900);
  });

  it('lets a host forfeit, and still lose if they were behind', async () => {
    const { home, away, awayRoom, battleId } = await battle();
    const fan = await adult('Asha');
    await grantCoins(fan.id, 50_000);
    await gift(fan, awayRoom, away.id, 10).expect(200);

    const res = await request(app)
      .post(`/v1/pk/battles/${battleId}/forfeit`)
      .set('Authorization', `Bearer ${home.token}`)
      .expect(200);

    expect(res.body.pk.winner).toBe(1);
  });

  it('refuses a forfeit from somebody who is not in the battle', async () => {
    const { battleId } = await battle();
    const stranger = await adult('Nosy');

    const res = await request(app)
      .post(`/v1/pk/battles/${battleId}/forfeit`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(403);

    expect(res.body.error.code).toBe('PK_NOT_YOURS');
  });
});

describe('random matchmaking', () => {
  it('pairs two waiting hosts, oldest first', async () => {
    const a = await adult('Anita');
    const b = await adult('Bimal');
    await goLive(a);
    await goLive(b);

    await request(app).post('/v1/pk/queue').set('Authorization', `Bearer ${a.token}`).expect(200);
    await request(app).post('/v1/pk/queue').set('Authorization', `Bearer ${b.token}`).expect(200);

    const { matched } = await matchPkQueue();
    expect(matched).toBe(1);

    const { rows } = await pool.query<{ home_user_id: string; away_user_id: string }>(
      "SELECT home_user_id, away_user_id FROM pk_battles WHERE state = 'live'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].home_user_id).toBe(a.id);
    // Both left the queue: a matched host must not be matched again.
    const queued = await pool.query('SELECT count(*)::int AS n FROM pk_queue');
    expect(queued.rows[0].n).toBe(0);
  });

  it('leaves a lone host waiting rather than matching them with nobody', async () => {
    const a = await adult('Anita');
    await goLive(a);
    await request(app).post('/v1/pk/queue').set('Authorization', `Bearer ${a.token}`).expect(200);

    expect((await matchPkQueue()).matched).toBe(0);
    const queued = await pool.query('SELECT count(*)::int AS n FROM pk_queue');
    expect(queued.rows[0].n).toBe(1);
  });

  it('drops a host whose room has ended', async () => {
    const a = await adult('Anita');
    const roomId = await goLive(a);
    await request(app).post('/v1/pk/queue').set('Authorization', `Bearer ${a.token}`).expect(200);
    await request(app)
      .post(`/v1/rooms/${roomId}/end`)
      .set('Authorization', `Bearer ${a.token}`)
      .expect(200);

    expect((await matchPkQueue()).expired).toBe(1);
  });
});

describe('the money boundary', () => {
  it('moves no money at all — a whole battle writes nothing to the ledger', async () => {
    // THE test for this module. PK is a scoreboard: every gift counted was
    // already paid to its recipient by `gifting`, through the ledger, when it
    // was sent. Pooling the two audiences' gifts, or refunding the losing
    // side, turns a purchase into a wager on an uncertain outcome — an online
    // money game under the Act, which is hard rule #1.
    //
    // So the ledger must contain exactly what the gift wrote, and settlement
    // must add nothing.
    const { home, homeRoom, battleId } = await battle();
    const fan = await adult('Asha');
    await grantCoins(fan.id, 50_000);
    await gift(fan, homeRoom, home.id, 10).expect(200);

    const before = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM ledger_txns');

    await endWindow(battleId);
    await settleDuePkBattles();

    const after = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM ledger_txns');
    expect(after.rows[0].n).toBe(before.rows[0].n);

    // And the ledger is still sound.
    expect(await unbalancedTxns()).toHaveLength(0);
    expect(await balanceDrift()).toHaveLength(0);
  });

  it('pays the winner nothing beyond the gifts they were already sent', async () => {
    const { home, homeRoom, battleId } = await battle();
    const fan = await adult('Asha');
    await grantCoins(fan.id, 50_000);
    await gift(fan, homeRoom, home.id, 10).expect(200);

    const points = async () => {
      const { rows } = await pool.query<{ amount: string }>(
        `SELECT COALESCE(SUM(e.amount), 0) AS amount
           FROM ledger_entries e
           JOIN ledger_accounts a ON a.id = e.account_id
          WHERE a.scope_id = $1 AND e.unit = 'point'`,
        [home.id],
      );
      return Number(rows[0].amount);
    };

    const before = await points();
    await endWindow(battleId);
    await settleDuePkBattles();
    expect(await points()).toBe(before);
  });

  it('never lets the streak multiplier touch a payout', async () => {
    // The multiplier is display-only. It is computed in `pk.config.ts` and
    // read by the app; nothing hands it to `economy`. This asserts the
    // observable half: a host on a streak is paid the same points per coin as
    // a host on none.
    const { home, away, homeRoom, awayRoom, battleId } = await battle();
    const fan = await adult('Asha');
    await grantCoins(fan.id, 200_000);

    await gift(fan, homeRoom, home.id, 10).expect(200);
    await endWindow(battleId);
    await settleDuePkBattles(); // home now has a streak of 1

    const second = await request(app)
      .post('/v1/pk/invites')
      .set('Authorization', `Bearer ${home.token}`)
      .send({ toUserId: away.id })
      .expect(201);
    const round2 = await request(app)
      .post(`/v1/pk/invites/${second.body.inviteId}/accept`)
      .set('Authorization', `Bearer ${away.token}`)
      .send({})
      .expect(200);

    // The multiplier is visible…
    expect(round2.body.pk.sides[0].winMultiplier).toBeGreaterThan(1);

    // …and the gift it sits beside pays exactly the same as any other.
    const streaked = await gift(fan, homeRoom, home.id, 1).expect(200);
    const plain = await gift(fan, awayRoom, away.id, 1).expect(200);
    expect(streaked.body.gift.coinPrice).toBe(plain.body.gift.coinPrice);

    const pointsFor = async (userId: string) => {
      const { rows } = await pool.query<{ points: string }>(
        `SELECT COALESCE(SUM(points), 0) AS points FROM gift_sends
          WHERE recipient_user_id = $1 AND quantity = 1`,
        [userId],
      );
      return Number(rows[0].points);
    };
    expect(await pointsFor(home.id)).toBe(await pointsFor(away.id));
  });
});
