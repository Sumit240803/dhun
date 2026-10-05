// The agency coin channel end to end: prepay under maker-checker, then
// transfers out, with the ledger checked after every step.
//
// What this suite is really guarding (ledger-decisions § C3/C4):
//   · coins are minted only by a SECOND admin confirming a payment
//   · an agency can never move a coin it has not bought
//   · a transfer books no revenue and leaves the float reconciling
//   · one payment, and one transfer request, can only ever land once
import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { ECONOMY, postTransaction, unitsToPaise } from '../src/modules/economy/index.js';
import { runReconciliation } from '../src/workers/jobs/reconciliation.js';
import {
  balanceDrift,
  closePool,
  createUser,
  resetLedger,
  sumEntries,
  systemBalance,
  unbalancedTxns,
} from './helpers.js';

const app = buildApp();
let phoneCounter = 0;
const nextPhone = () => `+9192${String(70_000_000 + phoneCounter++).slice(-8)}`;

interface User {
  id: string;
  publicId: number;
  token: string;
}

async function registered(name = 'Asha'): Promise<User> {
  const phone = nextPhone();
  const otp = await request(app).post('/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await request(app)
    .post('/v1/auth/otp/verify')
    .send({
      phone,
      code: otp.body.devCode,
      device: { deviceId: `ac-${randomUUID()}`, platform: 'android' },
    })
    .expect(200);
  const token = res.body.accessToken as string;
  await request(app)
    .patch('/v1/auth/profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ dateOfBirth: '1995-06-15', displayName: name })
    .expect(200);
  const { rows } = await pool.query('SELECT public_id FROM users WHERE id = $1', [
    res.body.user.id,
  ]);
  return { id: res.body.user.id, publicId: Number(rows[0].public_id), token };
}

const auth = (u: User) => ({ Authorization: `Bearer ${u.token}` });

async function staff(name = 'Ops'): Promise<User> {
  const admin = await registered(name);
  await pool.query(
    "INSERT INTO role_assignments (id, user_id, role_code, scope_type) VALUES ($1, $2, 'ops_manager', 'global')",
    [randomUUID(), admin.id],
  );
  return admin;
}

/** An agency approved for coin trading, with its owner. */
async function tradingAgency(maker: User, name = 'Sur Talent') {
  const owner = await registered('Owner');
  const created = await request(app)
    .post('/v1/admin/agencies')
    .set(auth(maker))
    .send({ ownerUserId: owner.publicId, name })
    .expect(201);
  const agency = created.body.agency as { id: string; publicId: number };
  await request(app)
    .post(`/v1/admin/agencies/${agency.id}/coin-trading`)
    .set(auth(maker))
    .send({ enabled: true })
    .expect(200);
  return { owner, agency };
}

const ONE_LAKH = 10_000_000; // ₹1,00,000 in paise — lands in the 132 coins/₹ tier.

async function recordPrepay(maker: User, agencyPublicId: number, amountPaise = ONE_LAKH) {
  const res = await request(app)
    .post('/v1/admin/agencies/prepays')
    .set(auth(maker))
    .send({
      agencyId: agencyPublicId,
      amountPaise,
      method: 'bank_transfer',
      paymentReference: `UTR${randomUUID().slice(0, 12)}`,
    })
    .expect(201);
  return res.body.prepay as { id: string; coins: number; coinsPerRupee: number };
}

/** A funded agency: prepaid and confirmed, coins sitting in inventory. */
async function fundedAgency(amountPaise = ONE_LAKH) {
  const maker = await staff('Maker');
  const checker = await staff('Checker');
  const { owner, agency } = await tradingAgency(maker);
  const prepay = await recordPrepay(maker, agency.publicId, amountPaise);
  await request(app)
    .post(`/v1/admin/agencies/prepays/${prepay.id}/confirm`)
    .set(auth(checker))
    .expect(200);
  return { maker, checker, owner, agency, prepay };
}

const sendTransfer = (owner: User, body: Record<string, unknown>) =>
  request(app).post('/v1/agency/transfers').set(auth(owner)).send(body);

beforeEach(resetLedger);
afterAll(closePool);

describe('prepay', () => {
  it('mints nothing when it is only recorded', async () => {
    const maker = await staff();
    const { agency } = await tradingAgency(maker);
    const prepay = await recordPrepay(maker, agency.publicId);

    expect(prepay.coinsPerRupee).toBe(132);
    expect(prepay.coins).toBe(13_200_000);
    expect(await sumEntries('agency_inventory', agency.id)).toBe(0);
  });

  it('refuses the admin who recorded it — maker is never checker', async () => {
    const maker = await staff();
    const { agency } = await tradingAgency(maker);
    const prepay = await recordPrepay(maker, agency.publicId);

    await request(app)
      .post(`/v1/admin/agencies/prepays/${prepay.id}/confirm`)
      .set(auth(maker))
      .expect(422);
    expect(await sumEntries('agency_inventory', agency.id)).toBe(0);
  });

  it('mints the coins on a second admin confirming, and books the rupees once', async () => {
    const { agency, prepay } = await fundedAgency();

    expect(await sumEntries('agency_inventory', agency.id)).toBe(prepay.coins);
    // ₹1,00,000 collected, and the coins carry their face value as deferred
    // revenue — nothing is recognised until a coin is SPENT.
    expect(await systemBalance('cash_reseller')).toBe(ONE_LAKH);
    expect(await systemBalance('deferred_revenue')).toBe(-unitsToPaise(prepay.coins));
    expect(await systemBalance('revenue_gifting')).toBe(0);
    expect(await unbalancedTxns()).toEqual([]);
    expect(await balanceDrift()).toEqual([]);
  });

  it('books a premium, not a discount, when wholesale is below face value', async () => {
    // 124 coins/₹ against a 130/₹ accounting rate: the agency pays MORE than
    // face, so discount_reseller is credited rather than debited.
    const { prepay } = await fundedAgency(1_000_000);
    expect(prepay.coinsPerRupee).toBe(124);
    expect(unitsToPaise(prepay.coins)).toBeLessThan(1_000_000);
    expect(await systemBalance('discount_reseller')).toBe(unitsToPaise(prepay.coins) - 1_000_000);
  });

  it('mints once however many confirmations are raced', async () => {
    const maker = await staff('Maker');
    const checker = await staff('Checker');
    const { agency } = await tradingAgency(maker);
    const prepay = await recordPrepay(maker, agency.publicId);

    // Every one of these may answer 200: the later ones are the ledger
    // collapsing a duplicate of the same key, not a second mint. What must be
    // true is that the coins exist exactly once.
    await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post(`/v1/admin/agencies/prepays/${prepay.id}/confirm`)
          .set(auth(checker))
          .then((r) => r.status),
      ),
    );

    expect(await sumEntries('agency_inventory', agency.id)).toBe(prepay.coins);
    const { rows } = await pool.query(
      "SELECT count(*) FROM ledger_txns WHERE idempotency_key = $1 AND status = 'completed'",
      [`prepay:${prepay.id}`],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('records one bank reference once, and refuses a rejected prepay afterwards', async () => {
    const maker = await staff('Maker');
    const checker = await staff('Checker');
    const { agency } = await tradingAgency(maker);
    const reference = 'UTR556677889900';
    const body = {
      agencyId: agency.publicId,
      amountPaise: ONE_LAKH,
      method: 'bank_transfer',
      paymentReference: reference,
    };
    const first = await request(app)
      .post('/v1/admin/agencies/prepays')
      .set(auth(maker))
      .send(body)
      .expect(201);
    const again = await request(app)
      .post('/v1/admin/agencies/prepays')
      .set(auth(maker))
      .send(body)
      .expect(409);
    expect(again.body.error.code).toBe('PREPAY_REFERENCE_USED');

    await request(app)
      .post(`/v1/admin/agencies/prepays/${first.body.prepay.id}/reject`)
      .set(auth(checker))
      .send({ reason: 'No credit found in the statement' })
      .expect(200);
    await request(app)
      .post(`/v1/admin/agencies/prepays/${first.body.prepay.id}/confirm`)
      .set(auth(checker))
      .expect(409);
    expect(await sumEntries('agency_inventory', agency.id)).toBe(0);
  });

  it('refuses an agency without the coin-trading grant, and a prepay under the floor', async () => {
    const maker = await staff();
    const owner = await registered('Owner');
    const created = await request(app)
      .post('/v1/admin/agencies')
      .set(auth(maker))
      .send({ ownerUserId: owner.publicId, name: 'Hosts Only' })
      .expect(201);

    const ungranted = await request(app)
      .post('/v1/admin/agencies/prepays')
      .set(auth(maker))
      .send({
        agencyId: created.body.agency.publicId,
        amountPaise: ONE_LAKH,
        method: 'upi',
        paymentReference: 'UPI12345678',
      })
      .expect(409);
    expect(ungranted.body.error.code).toBe('COIN_TRADING_DISABLED');

    const { agency } = await tradingAgency(maker, 'Trader');
    const small = await request(app)
      .post('/v1/admin/agencies/prepays')
      .set(auth(maker))
      .send({
        agencyId: agency.publicId,
        amountPaise: 500_000,
        method: 'upi',
        paymentReference: 'UPI87654321',
      })
      .expect(422);
    expect(small.body.error.code).toBe('PREPAY_TOO_SMALL');
  });

  it('is staff only', async () => {
    const outsider = await registered();
    await request(app)
      .post('/v1/admin/agencies/prepays')
      .set(auth(outsider))
      .send({
        agencyId: 700001,
        amountPaise: ONE_LAKH,
        method: 'upi',
        paymentReference: 'UPI00000001',
      })
      .expect(404);
  });
});

describe('transfer', () => {
  it('moves coins to the user and books no revenue at all', async () => {
    const { owner, agency, prepay } = await fundedAgency();
    const user = await registered('Sunita');
    const floatBefore = await systemBalance('system_coin_float');
    const deferredBefore = await systemBalance('deferred_revenue');

    const res = await sendTransfer(owner, {
      userId: user.publicId,
      coins: 11_000,
      requestId: randomUUID(),
      note: 'UPI received',
    }).expect(201);

    expect(res.body.transfer.coins).toBe(11_000);
    expect(await sumEntries('user_coins', user.id)).toBe(11_000);
    expect(await sumEntries('agency_inventory', agency.id)).toBe(prepay.coins - 11_000);
    // The rupees were booked at prepay. A transfer that moved money here would
    // count them twice.
    expect(await systemBalance('system_coin_float')).toBe(floatBefore);
    expect(await systemBalance('deferred_revenue')).toBe(deferredBefore);
    expect(await systemBalance('cash_reseller')).toBe(ONE_LAKH);
    expect(await unbalancedTxns()).toEqual([]);
    expect(await balanceDrift()).toEqual([]);
  });

  it('refuses coins the agency has not bought — hard rule #3', async () => {
    const { owner, agency, prepay } = await fundedAgency(1_000_000); // 1,240,000 coins
    const user = await registered();
    // Past the opening window, so the per-transfer cap is not what refuses this.
    await pool.query("UPDATE agencies SET created_at = now() - interval '31 days' WHERE id = $1", [
      agency.id,
    ]);

    await sendTransfer(owner, {
      userId: user.publicId,
      coins: 1_100_000,
      requestId: randomUUID(),
    }).expect(201);
    const remaining = prepay.coins - 1_100_000;

    // Within every cap, but more than the inventory holds.
    const res = await sendTransfer(owner, {
      userId: user.publicId,
      coins: remaining + 1,
      requestId: randomUUID(),
    }).expect(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await sumEntries('user_coins', user.id)).toBe(1_100_000);
    expect(await sumEntries('agency_inventory', agency.id)).toBe(remaining);
  });

  it('sends once however many times the request is retried', async () => {
    const { owner, agency, prepay } = await fundedAgency();
    const user = await registered();
    const requestId = randomUUID();

    const statuses = await Promise.all(
      Array.from({ length: 5 }, () =>
        sendTransfer(owner, { userId: user.publicId, coins: 5_000, requestId }).then(
          (r) => r.status,
        ),
      ),
    );
    expect(statuses.every((s) => s === 201)).toBe(true);
    expect(await sumEntries('user_coins', user.id)).toBe(5_000);
    expect(await sumEntries('agency_inventory', agency.id)).toBe(prepay.coins - 5_000);
    const { rows } = await pool.query(
      'SELECT count(*) FROM agency_transfers WHERE agency_id = $1',
      [agency.id],
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it('holds the caps a new agency starts on, counting what is already sent today', async () => {
    const { owner } = await fundedAgency(100_000_000); // ₹10,00,000 → plenty of stock
    const user = await registered();

    // A brand-new agency is on the reduced caps: 275,000 a transfer.
    const tooBig = await sendTransfer(owner, {
      userId: user.publicId,
      coins: 275_001,
      requestId: randomUUID(),
    }).expect(422);
    expect(tooBig.body.error.code).toBe('TRANSFER_TOO_LARGE');

    // 1,100,000 a day to one recipient: four full transfers, then refused.
    for (let i = 0; i < 4; i++) {
      await sendTransfer(owner, {
        userId: user.publicId,
        coins: 275_000,
        requestId: randomUUID(),
      }).expect(201);
    }
    const capped = await sendTransfer(owner, {
      userId: user.publicId,
      coins: 1,
      requestId: randomUUID(),
    }).expect(429);
    expect(capped.body.error.code).toBe('RECIPIENT_DAILY_LIMIT');

    // Another recipient is unaffected — the cap is per recipient, not global.
    const other = await registered('Other');
    await sendTransfer(owner, {
      userId: other.publicId,
      coins: 275_000,
      requestId: randomUUID(),
    }).expect(201);
    expect(await sumEntries('user_coins', user.id)).toBe(1_100_000);
  });

  it('lifts the reduced caps once the agency is past its opening window', async () => {
    const { owner, agency } = await fundedAgency(100_000_000);
    const user = await registered();
    await pool.query("UPDATE agencies SET created_at = now() - interval '31 days' WHERE id = $1", [
      agency.id,
    ]);

    await sendTransfer(owner, {
      userId: user.publicId,
      coins: 1_100_000,
      requestId: randomUUID(),
    }).expect(201);
    expect(await sumEntries('user_coins', user.id)).toBe(1_100_000);
  });

  it('refuses an unknown, banned or guest recipient, and the sender themselves', async () => {
    const { owner } = await fundedAgency();
    const banned = await registered('Banned');
    await pool.query("UPDATE users SET status = 'banned' WHERE id = $1", [banned.id]);
    const guest = await createUser('guest');
    const { rows } = await pool.query('SELECT public_id FROM users WHERE id = $1', [guest]);

    for (const publicId of [99_999_997, banned.publicId, Number(rows[0].public_id)]) {
      const res = await sendTransfer(owner, {
        userId: publicId,
        coins: 1_000,
        requestId: randomUUID(),
      }).expect(404);
      expect(res.body.error.code).toBe('RECIPIENT_NOT_FOUND');
    }

    const self = await sendTransfer(owner, {
      userId: owner.publicId,
      coins: 1_000,
      requestId: randomUUID(),
    }).expect(400);
    expect(self.body.error.code).toBe('TRANSFER_TO_SELF');
  });

  it('is refused to an agency whose coin trading was withdrawn', async () => {
    const { maker, owner, agency } = await fundedAgency();
    const user = await registered();
    await request(app)
      .post(`/v1/admin/agencies/${agency.id}/coin-trading`)
      .set(auth(maker))
      .send({ enabled: false })
      .expect(200);

    const res = await sendTransfer(owner, {
      userId: user.publicId,
      coins: 1_000,
      requestId: randomUUID(),
    }).expect(403);
    expect(res.body.error.code).toBe('COIN_TRADING_DISABLED');
  });

  it('is refused to anyone who is not the agency owner', async () => {
    const { owner } = await fundedAgency();
    const outsider = await registered('Outsider');
    const user = await registered();

    const res = await sendTransfer(outsider, {
      userId: user.publicId,
      coins: 1_000,
      requestId: randomUUID(),
    }).expect(403);
    expect(res.body.error.code).toBe('NOT_AGENCY_OWNER');
    expect(await sumEntries('user_coins', user.id)).toBe(0);
    await request(app).get('/v1/agency/inventory').set(auth(outsider)).expect(403);
    await request(app).get('/v1/agency/inventory').set(auth(owner)).expect(200);
  });

  it('shows both sides the same permanent record', async () => {
    const { owner, agency } = await fundedAgency();
    const user = await registered('Sunita');
    await sendTransfer(owner, {
      userId: user.publicId,
      coins: 9_000,
      requestId: randomUUID(),
      note: 'Paid by UPI',
    }).expect(201);

    const sent = await request(app).get('/v1/agency/transfers').set(auth(owner)).expect(200);
    const received = await request(app).get('/v1/agency/received').set(auth(user)).expect(200);
    expect(sent.body.transfers).toHaveLength(1);
    expect(received.body.transfers).toHaveLength(1);
    expect(received.body.transfers[0].id).toBe(sent.body.transfers[0].id);
    expect(received.body.transfers[0].agency.publicId).toBe(agency.publicId);
    expect(sent.body.transfers[0].recipient.publicId).toBe(user.publicId);

    const inventory = await request(app).get('/v1/agency/inventory').set(auth(owner)).expect(200);
    expect(inventory.body.usedToday).toEqual({ coins: 9_000, count: 1 });
    expect(inventory.body.isNewAgency).toBe(true);
  });

  it('leaves the coins spendable like any other — they gift at the normal rate', async () => {
    const { owner } = await fundedAgency();
    const user = await registered('Spender');
    await sendTransfer(owner, {
      userId: user.publicId,
      coins: 20_000,
      requestId: randomUUID(),
    }).expect(201);

    const before = await systemBalance('revenue_gifting');
    const host = await registered('Host');
    const room = await request(app)
      .post('/v1/rooms/live')
      .set(auth(host))
      .send({ title: 'Evening ghazals', tag: 'chatting' })
      .expect(201);
    await request(app)
      .post('/v1/gifts/send')
      .set(auth(user))
      .set('Idempotency-Key', randomUUID())
      .send({
        roomId: room.body.room.id,
        recipientId: host.id,
        giftId: 'rose',
        quantity: 1,
        expectedCoinPrice: 90,
      })
      .expect(200);

    // Revenue is recognised on the SPEND, not on the transfer — and the host
    // earns the ordinary 60% of the coin count as points.
    expect(await systemBalance('revenue_gifting')).toBe(before - unitsToPaise(90));
    expect(await sumEntries('host_points_held', host.id)).toBe(
      Math.floor((90 * ECONOMY.defaultGiftPayoutRateBp) / 10_000),
    );
  });
});

describe('nightly reconciliation of the channel', () => {
  /** A prepay and a transfer, both clean, as the checks should find them. */
  async function movedCoins() {
    const { owner, agency, prepay } = await fundedAgency();
    const user = await registered('Sunita');
    await sendTransfer(owner, {
      userId: user.publicId,
      coins: 7_000,
      requestId: randomUUID(),
    }).expect(201);
    return { owner, agency, prepay, user };
  }

  const outcome = async (name: string) => (await runReconciliation()).find((o) => o.name === name);

  it('passes on a channel that has done nothing wrong', async () => {
    await movedCoins();
    expect((await outcome('agency_prepays_match_ledger'))?.status).toBe('pass');
    expect((await outcome('agency_transfers_match_ledger'))?.status).toBe('pass');
  });

  it('catches a prepay pointing at a transaction that did not mint it', async () => {
    const { prepay, agency } = await movedCoins();
    // Everything cheap is already blocked: `prepay_state_consistent` refuses a
    // confirmed prepay with no transaction, and `prepay_coins_match_rate`
    // refuses coins that do not match the quote. What a bug CAN still do is
    // wire up the wrong transaction — so that is what this corrupts, with only
    // the finality trigger lifted.
    const { rows } = await pool.query(
      'SELECT ledger_txn_id FROM agency_transfers WHERE agency_id = $1',
      [agency.id],
    );
    await pool.query('ALTER TABLE agency_prepays DISABLE TRIGGER trg_agency_prepays_final');
    await pool.query('UPDATE agency_prepays SET ledger_txn_id = $2 WHERE id = $1', [
      prepay.id,
      rows[0].ledger_txn_id,
    ]);
    await pool.query('ALTER TABLE agency_prepays ENABLE TRIGGER trg_agency_prepays_final');

    const check = await outcome('agency_prepays_match_ledger');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toMatchObject({ mismatched: 1 });
  });

  it('catches reseller cash booked without a prepay behind it', async () => {
    await movedCoins();
    // A manual adjustment that credits the reseller cash account with no prepay
    // to explain it. Perfectly balanced, perfectly postable — and exactly the
    // kind of entry that makes the bank statement stop agreeing with our books.
    await postTransaction({
      txnType: 'admin_credit',
      idempotencyKey: `stray-cash:${randomUUID()}`,
      identity: { reason: 'test' },
      rates: {
        faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
        pointsPerRupee: ECONOMY.pointsPerRupee,
      },
      legs: [
        { accountCode: 'cash_reseller', unit: 'paise', amount: 100 },
        { accountCode: 'deferred_revenue', unit: 'paise', amount: -100 },
      ],
    });

    const check = await outcome('agency_prepays_match_ledger');
    expect(check?.status).toBe('fail');
    // ₹1 on our books that no prepay accounts for.
    expect(check?.detail).toMatchObject({ cashDrift: 100 });
  });

  it('catches a transfer the ledger made but no record shows', async () => {
    const { agency } = await movedCoins();
    await pool.query('ALTER TABLE agency_transfers DISABLE TRIGGER trg_agency_transfers_immutable');
    await pool.query('DELETE FROM agency_transfers WHERE agency_id = $1', [agency.id]);
    await pool.query('ALTER TABLE agency_transfers ENABLE TRIGGER trg_agency_transfers_immutable');

    const check = await outcome('agency_transfers_match_ledger');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toMatchObject({ missing: 1 });
  });

  it('catches a record claiming different coins from the ones that moved', async () => {
    const { agency } = await movedCoins();
    await pool.query('ALTER TABLE agency_transfers DISABLE TRIGGER trg_agency_transfers_immutable');
    await pool.query('UPDATE agency_transfers SET coins = coins + 1 WHERE agency_id = $1', [
      agency.id,
    ]);
    await pool.query('ALTER TABLE agency_transfers ENABLE TRIGGER trg_agency_transfers_immutable');

    const check = await outcome('agency_transfers_match_ledger');
    expect(check?.status).toBe('fail');
    expect(check?.detail).toMatchObject({ mismatched: 1 });
  });
});
