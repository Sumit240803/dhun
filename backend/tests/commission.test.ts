// Commission: the rate, the split, and the close.
//
// The three things that must hold whatever the tree looks like:
//   · the platform's total cost is team points × the AGENCY's rate — the split
//     between agency and sub-agent only decides who receives it;
//   · a host who moved mid-period has each gift attributed by its timestamp;
//   · the rate for a period was fixed before the period began, so nothing is
//     ever repriced.
import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { closePeriod, istMonth, openPeriod, previousMonth } from '../src/modules/agency/index.js';
import { ECONOMY, pointsToPaise } from '../src/modules/economy/index.js';
import { balanceDrift, closePool, resetLedger, sumEntries, unbalancedTxns } from './helpers.js';

const app = buildApp();
let phoneCounter = 0;
const nextPhone = () => `+9190${String(90_000_000 + phoneCounter++).slice(-8)}`;

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
      device: { deviceId: `cm-${randomUUID()}`, platform: 'android' },
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

async function staff(): Promise<User> {
  const admin = await registered('Ops');
  await pool.query(
    "INSERT INTO role_assignments (id, user_id, role_code, scope_type) VALUES ($1, $2, 'ops_manager', 'global')",
    [randomUUID(), admin.id],
  );
  return admin;
}

async function agency(admin: User, name = 'Sur Talent') {
  const owner = await registered('Owner');
  const res = await request(app)
    .post('/v1/admin/agencies')
    .set(auth(admin))
    .send({ ownerUserId: owner.publicId, name })
    .expect(201);
  return {
    owner,
    agencyId: res.body.agency.id as string,
    ownerAgentId: res.body.ownerSeat.publicId as number,
  };
}

async function addAgent(owner: User) {
  const person = await registered('Sub');
  const invite = await request(app)
    .post('/v1/agency/agents/invites')
    .set(auth(owner))
    .send({ userId: person.publicId })
    .expect(201);
  await request(app)
    .post(`/v1/agency/agents/invites/${invite.body.invite.id}/accept`)
    .set(auth(person))
    .expect(200);
  const roster = await request(app).get('/v1/agency/agents').set(auth(owner)).expect(200);
  const seat = roster.body.agents.find((a: { userId: string }) => a.userId === person.id) as {
    id: string;
    publicId: number;
  };
  return { person, seat };
}

async function hostUnder(agentPublicId: number, accepter: User, name = 'Sunita'): Promise<User> {
  const host = await registered(name);
  const applied = await request(app)
    .post('/v1/agency/join')
    .set(auth(host))
    .send({ agentId: agentPublicId })
    .expect(201);
  await request(app)
    .post(`/v1/agency/requests/${applied.body.request.id}/accept`)
    .set(auth(accepter))
    .expect(200);
  return host;
}

/**
 * A gift of `points` to a host, dated into a past period.
 *
 * Written straight to the ledger: making a real gift needs a live room and a
 * funded sender, and none of that is what these tests are about. The shape is
 * the same one `giftLegs` posts, and `gift_sends` carries what the close reads.
 */
async function roomFor(host: User): Promise<string> {
  const { rows } = await pool.query(
    'SELECT id FROM rooms WHERE host_user_id = $1 AND ended_at IS NULL LIMIT 1',
    [host.id],
  );
  if (rows[0]) return rows[0].id;
  const res = await request(app)
    .post('/v1/rooms/live')
    .set(auth(host))
    .send({ title: 'Test room', tag: 'chatting' })
    .expect(201);
  return res.body.room.id as string;
}

async function giftPoints(host: User, points: number, at: Date): Promise<void> {
  const coins = Math.round((points * 10_000) / ECONOMY.defaultGiftPayoutRateBp);
  const txnId = randomUUID();
  const sender = await registered('Sender');
  const roomId = await roomFor(host);

  await pool.query(
    `INSERT INTO ledger_txns (id, txn_type, idempotency_key, identity, rates, status, created_at)
     VALUES ($1, 'gift_send', $2, '{}', '{}', 'completed', $3)`,
    [txnId, `test-gift:${txnId}`, at.toISOString()],
  );
  await pool.query(
    `INSERT INTO gift_sends
       (txn_id, room_id, sender_user_id, recipient_user_id, gift_id, quantity,
        unit_price, coins, points, payout_rate_bp, created_at)
     VALUES ($1, $2, $3, $4, 'rose', 1, $5, $5, $6, $7, $8)`,
    [
      txnId,
      roomId,
      sender.id,
      host.id,
      coins,
      points,
      ECONOMY.defaultGiftPayoutRateBp,
      at.toISOString(),
    ],
  );
}

/**
 * Push every open agency link back before the periods under test.
 *
 * The tree is built now and the gifts are dated months back, so without this
 * the two dated lookups correctly find nobody — the host had not joined yet.
 */
async function backdateLinks(): Promise<void> {
  await pool.query(
    "UPDATE host_agent_assignments SET effective_from = now() - interval '6 months' WHERE effective_to IS NULL",
  );
  await pool.query(
    "UPDATE agent_agency_assignments SET effective_from = now() - interval '6 months' WHERE effective_to IS NULL",
  );
}

/** A date inside a period, safely away from both IST boundaries. */
function inPeriod(period: string, day = 15): Date {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, 6, 0, 0));
}

const LAST = previousMonth(istMonth());
const BEFORE = previousMonth(LAST);

const accrual = async (period: string, payeeType: string, payeeId: string) => {
  const { rows } = await pool.query(
    'SELECT base_points, rate_bp, points FROM commission_accruals WHERE period = $1 AND payee_type = $2 AND payee_id = $3',
    [period, payeeType, payeeId],
  );
  return rows[0]
    ? {
        basePoints: Number(rows[0].base_points),
        rateBp: rows[0].rate_bp,
        points: Number(rows[0].points),
      }
    : null;
};

beforeEach(resetLedger);
afterAll(closePool);

describe('the rate', () => {
  it('starts every new agency at D, the bottom band', async () => {
    const admin = await staff();
    const { agencyId } = await agency(admin);
    await openPeriod(LAST);

    const { rows } = await pool.query(
      "SELECT level, rate_bp FROM commission_levels WHERE period = $1 AND payee_type = 'agency' AND payee_id = $2",
      [LAST, agencyId],
    );
    expect(rows[0]).toMatchObject({ level: 'D', rate_bp: 400 });
  });

  it('is set by the PREVIOUS period, so a period is never repriced', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    const host = await hostUnder(ownerAgentId, owner);
    await backdateLinks();

    // A big month before last: enough team volume to reach C (2,000,000).
    await giftPoints(host, 3_000_000, inPeriod(BEFORE));
    await closePeriod(BEFORE);

    // That volume sets LAST's rate, not BEFORE's — BEFORE was priced at D.
    const before = await accrual(BEFORE, 'agency', agencyId);
    expect(before).toMatchObject({ rateBp: 400, basePoints: 3_000_000 });
    expect(before?.points).toBe(Math.floor((3_000_000 * 400) / 10_000));

    const { rows } = await pool.query(
      "SELECT level, rate_bp, measured_points FROM commission_levels WHERE period = $1 AND payee_type = 'agency' AND payee_id = $2",
      [LAST, agencyId],
    );
    expect(rows[0]).toMatchObject({ level: 'C', rate_bp: 800, measured_points: '3000000' });
  });

  it('lets a level fall by at most one step in a period', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    const host = await hostUnder(ownerAgentId, owner);

    // Pretend they finished the earlier period at S.
    await openPeriod(BEFORE);
    await pool.query(
      "UPDATE commission_levels SET level = 'S', rate_bp = 2000 WHERE period = $1 AND payee_id = $2",
      [BEFORE, agencyId],
    );
    // Then earn almost nothing, which on its own merits is D.
    await backdateLinks();
    await giftPoints(host, 1_000, inPeriod(BEFORE));
    await closePeriod(BEFORE);

    const { rows } = await pool.query(
      "SELECT level, rate_bp, cushioned FROM commission_levels WHERE period = $1 AND payee_type = 'agency' AND payee_id = $2",
      [LAST, agencyId],
    );
    // A, not D: one step down, and the row says it was held up.
    expect(rows[0]).toMatchObject({ level: 'A', rate_bp: 1600, cushioned: true });
  });
});

describe('the split', () => {
  it('pays the agency the whole rate on a host the owner holds directly', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    const { seat } = await addAgent(owner);

    await openPeriod(LAST);
    await pool.query(
      "UPDATE commission_levels SET level = 'B', rate_bp = 1200 WHERE period = $1 AND payee_type = 'agency'",
      [LAST],
    );

    const direct = await hostUnder(ownerAgentId, owner, 'Direct');
    await backdateLinks();
    await giftPoints(direct, 1_000_000, inPeriod(LAST));

    await closePeriod(LAST);

    // The owner's seat earns nothing separately — it would be paying twice for
    // the same work — and the sub-agent, holding nobody, earns nothing at all.
    const agencyRow = await accrual(LAST, 'agency', agencyId);
    expect(agencyRow).toMatchObject({ basePoints: 1_000_000, rateBp: 1200 });
    expect(agencyRow?.points).toBe(120_000);
    expect(await accrual(LAST, 'agent', seat.id)).toBeNull();
  });

  it('keeps the platform’s total cost at the agency’s rate, whoever holds the host', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    const { person, seat } = await addAgent(owner);

    await openPeriod(LAST);
    await pool.query(
      "UPDATE commission_levels SET rate_bp = 1200 WHERE period = $1 AND payee_type = 'agency'",
      [LAST],
    );
    await pool.query(
      "UPDATE commission_levels SET rate_bp = 800 WHERE period = $1 AND payee_type = 'agent'",
      [LAST],
    );

    const subHost = await hostUnder(seat.publicId, person, 'Under sub');
    const ownHost = await hostUnder(ownerAgentId, owner, 'Under owner');
    await backdateLinks();
    await giftPoints(subHost, 1_000_000, inPeriod(LAST));
    await giftPoints(ownHost, 500_000, inPeriod(LAST));

    await closePeriod(LAST);

    const agent = await accrual(LAST, 'agent', seat.id);
    const agencyRow = await accrual(LAST, 'agency', agencyId);

    // The sub-agent takes 8% of their own host.
    expect(agent).toMatchObject({ basePoints: 1_000_000, rateBp: 800, points: 80_000 });
    // The agency takes the 4% gap on that host, plus the full 12% on its own.
    expect(agencyRow?.points).toBe(1_000_000 * 0.04 + 500_000 * 0.12);
    // And the two together are exactly 12% of the whole team.
    expect((agent?.points ?? 0) + (agencyRow?.points ?? 0)).toBe(
      Math.floor((1_500_000 * 1200) / 10_000),
    );
  });

  it('caps a sub-agent’s rate at their agency’s', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    void ownerAgentId;
    const { person, seat } = await addAgent(owner);

    await openPeriod(LAST);
    // The agency slipped while the sub-agent climbed — the one case the
    // arithmetic does not handle on its own.
    await pool.query(
      "UPDATE commission_levels SET rate_bp = 800 WHERE period = $1 AND payee_type = 'agency'",
      [LAST],
    );
    await pool.query(
      "UPDATE commission_levels SET rate_bp = 2000 WHERE period = $1 AND payee_type = 'agent'",
      [LAST],
    );

    const host = await hostUnder(seat.publicId, person);
    await backdateLinks();
    await giftPoints(host, 1_000_000, inPeriod(LAST));
    await closePeriod(LAST);

    // Capped at 8%, so the agency's differential is zero rather than negative.
    expect(await accrual(LAST, 'agent', seat.id)).toMatchObject({ rateBp: 800, points: 80_000 });
    expect(await accrual(LAST, 'agency', agencyId)).toBeNull();
  });
});

describe('attribution', () => {
  it('splits a host who moved agents mid-period, by gift timestamp', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    const { person, seat } = await addAgent(owner);
    const host = await hostUnder(seat.publicId, person);
    await backdateLinks();

    await openPeriod(LAST);
    await pool.query(
      "UPDATE commission_levels SET rate_bp = 1200 WHERE period = $1 AND payee_type = 'agency'",
      [LAST],
    );
    await pool.query(
      "UPDATE commission_levels SET rate_bp = 800 WHERE period = $1 AND payee_type = 'agent'",
      [LAST],
    );

    // Earned under the sub-agent on the 10th.
    await giftPoints(host, 400_000, inPeriod(LAST, 10));
    // Moved to the owner on the 14th — exactly what removing an agent does.
    const moveAt = inPeriod(LAST, 14);
    await pool.query(
      'UPDATE host_agent_assignments SET effective_to = $2 WHERE host_user_id = $1 AND effective_to IS NULL',
      [host.id, moveAt.toISOString()],
    );
    const { rows: ownerSeat } = await pool.query(
      'SELECT owner_agent_id FROM agencies WHERE id = $1',
      [agencyId],
    );
    await pool.query(
      `INSERT INTO host_agent_assignments (id, host_user_id, agent_id, effective_from)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), host.id, ownerSeat[0].owner_agent_id, moveAt.toISOString()],
    );
    void ownerAgentId;
    // And earned again under the owner on the 20th.
    await giftPoints(host, 600_000, inPeriod(LAST, 20));

    await closePeriod(LAST);

    // The sub-agent is paid on the first half only.
    expect(await accrual(LAST, 'agent', seat.id)).toMatchObject({
      basePoints: 400_000,
      points: 32_000,
    });
    // The agency gets the gap on that, plus the full rate on the second half.
    expect((await accrual(LAST, 'agency', agencyId))?.points).toBe(400_000 * 0.04 + 600_000 * 0.12);

    const { rows } = await pool.query(
      'SELECT agent_id, points FROM commission_attributions WHERE host_user_id = $1 ORDER BY gift_at',
      [host.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].agent_id).toBe(seat.id);
    expect(rows[1].agent_id).toBe(ownerSeat[0].owner_agent_id);
  });

  it('ignores gifts to hosts in no agency, and the in-house agency', async () => {
    const admin = await staff();
    const loner = await registered('Loner');
    await giftPoints(loner, 500_000, inPeriod(LAST));

    const house = await registered('House');
    const created = await request(app)
      .post('/v1/admin/agencies')
      .set(auth(admin))
      .send({ ownerUserId: house.publicId, name: 'Dhun Official', isHouse: true })
      .expect(201);
    const houseHost = await hostUnder(created.body.ownerSeat.publicId, house, 'Seeded');
    await backdateLinks();
    await giftPoints(houseHost, 500_000, inPeriod(LAST));

    const result = await closePeriod(LAST);
    expect(result.attributions).toBe(0);
    expect(result.accruals).toHaveLength(0);
  });

  it('leaves out a gift reversed before the period closed', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    const host = await hostUnder(ownerAgentId, owner);
    await backdateLinks();
    await giftPoints(host, 1_000_000, inPeriod(LAST, 10));
    await giftPoints(host, 500_000, inPeriod(LAST, 12));

    const { rows } = await pool.query(
      'SELECT txn_id FROM gift_sends WHERE recipient_user_id = $1 ORDER BY created_at LIMIT 1',
      [host.id],
    );
    await pool.query(
      `INSERT INTO ledger_txns (id, txn_type, idempotency_key, identity, rates, status, reverses_txn_id)
       VALUES ($1, 'gift_send', $2, '{}', '{}', 'completed', $3)`,
      [randomUUID(), `rev:${randomUUID()}`, rows[0].txn_id],
    );

    await openPeriod(LAST);
    await pool.query(
      "UPDATE commission_levels SET rate_bp = 1000 WHERE period = $1 AND payee_type = 'agency'",
      [LAST],
    );
    await closePeriod(LAST);

    // Only the 500,000 that was not reversed.
    expect(await accrual(LAST, 'agency', agencyId)).toMatchObject({ basePoints: 500_000 });
  });
});

describe('closing', () => {
  it('posts one balanced transaction per payee and credits points', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    const host = await hostUnder(ownerAgentId, owner);
    await backdateLinks();
    await openPeriod(LAST);
    await pool.query(
      "UPDATE commission_levels SET rate_bp = 1000 WHERE period = $1 AND payee_type = 'agency'",
      [LAST],
    );
    await giftPoints(host, 1_000_000, inPeriod(LAST));

    await closePeriod(LAST);

    const points = 100_000;
    expect(await sumEntries('agency_points_held', agencyId)).toBe(points);
    // The rupee side is the obligation the points represent.
    const { rows } = await pool.query(
      "SELECT SUM(e.amount) AS total FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.code = 'expense_agency_commission'",
    );
    expect(Number(rows[0].total)).toBe(pointsToPaise(points));
    expect(await unbalancedTxns()).toEqual([]);
    expect(await balanceDrift()).toEqual([]);
  });

  it('is idempotent — closing twice credits once', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    const host = await hostUnder(ownerAgentId, owner);
    await backdateLinks();
    await giftPoints(host, 1_000_000, inPeriod(LAST));

    const first = await closePeriod(LAST);
    const second = await closePeriod(LAST);
    expect(first.alreadyClosed).toBe(false);
    expect(second.alreadyClosed).toBe(true);

    const { rows } = await pool.query(
      "SELECT count(*) FROM ledger_txns WHERE txn_type = 'agency_commission_accrual'",
    );
    expect(Number(rows[0].count)).toBe(1);
    expect(await sumEntries('agency_points_held', agencyId)).toBe(40_000);
  });

  it('refuses to close a period that has not finished', async () => {
    await expect(closePeriod(istMonth())).rejects.toThrow(/not finished/i);
  });

  it('fixes the next period’s rates as soon as it closes', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    const host = await hostUnder(ownerAgentId, owner);
    await backdateLinks();
    await giftPoints(host, 12_000_000, inPeriod(LAST));
    await closePeriod(LAST);

    // The month we are in now already has a rate, earned by last month.
    const { rows } = await pool.query(
      "SELECT level, rate_bp FROM commission_levels WHERE period = $1 AND payee_type = 'agency' AND payee_id = $2",
      [istMonth(), agencyId],
    );
    expect(rows[0]).toMatchObject({ level: 'B', rate_bp: 1200 });
  });
});

describe('what a payee sees', () => {
  it('shows the owner this period’s fixed rate and the volume setting the next', async () => {
    const admin = await staff();
    const { owner, ownerAgentId } = await agency(admin);
    const host = await hostUnder(ownerAgentId, owner);
    await backdateLinks();
    await giftPoints(host, 3_000_000, inPeriod(LAST));
    await closePeriod(LAST);
    // Earned in the CURRENT period, so it counts towards the next rate.
    await giftPoints(host, 11_000_000, new Date());

    const res = await request(app).get('/v1/agency/commission').set(auth(owner)).expect(200);
    expect(res.body.payeeType).toBe('agency');
    expect(res.body.current).toMatchObject({ level: 'C', rateBp: 800 });
    expect(res.body.earningNow).toBe(11_000_000);
    expect(res.body.projected).toMatchObject({ level: 'B', rateBp: 1200 });
    expect(res.body.history[0]).toMatchObject({ period: LAST, rateBp: 400 });
  });

  it('is refused to someone with no agent seat', async () => {
    const user = await registered();
    const res = await request(app).get('/v1/agency/commission').set(auth(user)).expect(403);
    expect(res.body.error.code).toBe('NOT_AN_AGENT');
  });
});
