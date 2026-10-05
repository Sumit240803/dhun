// Sub-agents and the back office.
//
// The rule worth the most care here: removing an agent must never strand their
// hosts. They joined an agency, not a person, so they move to the owner — and
// because both links are dated, every gift stays attributed to whoever actually
// held them at the time.
import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();
let phoneCounter = 0;
const nextPhone = () => `+9191${String(80_000_000 + phoneCounter++).slice(-8)}`;

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
      device: { deviceId: `aa-${randomUUID()}`, platform: 'android' },
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
    agencyPublicId: res.body.agency.publicId as number,
    ownerAgentId: res.body.ownerSeat.publicId as number,
  };
}

/** Invite someone and have them accept: the ordinary way a sub-agent appears. */
async function addAgent(owner: User, canManageAgents = false) {
  const person = await registered('Sub');
  const invite = await request(app)
    .post('/v1/agency/agents/invites')
    .set(auth(owner))
    .send({ userId: person.publicId, canManageAgents })
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

/** A host joining a given agent, both sides consenting. */
async function hostUnder(agentPublicId: number, accepter: User, name = 'Sunita') {
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

beforeEach(resetLedger);
afterAll(closePool);

describe('inviting a sub-agent', () => {
  it('needs the person to accept before the seat exists', async () => {
    const admin = await staff();
    const { owner } = await agency(admin);
    const person = await registered('Sub');

    const invite = await request(app)
      .post('/v1/agency/agents/invites')
      .set(auth(owner))
      .send({ userId: person.publicId, message: 'Run the Bhojpuri team' })
      .expect(201);
    expect((await request(app).get('/v1/agency/me').set(auth(person))).body.seat).toBeNull();

    const mine = await request(app).get('/v1/agency/agents/invites').set(auth(person)).expect(200);
    expect(mine.body.mine).toHaveLength(1);

    await request(app)
      .post(`/v1/agency/agents/invites/${invite.body.invite.id}/accept`)
      .set(auth(person))
      .expect(200);

    const me = await request(app).get('/v1/agency/me').set(auth(person)).expect(200);
    expect(me.body.seat).toMatchObject({ isOwner: false, canManageAgents: false });
    expect(me.body.seat.agency.name).toBe('Sur Talent');
  });

  it('can carry agent management, which the invitee can see before accepting', async () => {
    const admin = await staff();
    const { owner } = await agency(admin);
    const { person } = await addAgent(owner, true);

    const me = await request(app).get('/v1/agency/me').set(auth(person)).expect(200);
    expect(me.body.seat.canManageAgents).toBe(true);
    // And with it, they can invite the next one.
    const next = await registered('Third');
    await request(app)
      .post('/v1/agency/agents/invites')
      .set(auth(person))
      .send({ userId: next.publicId })
      .expect(201);
  });

  it('is refused to an agent without agent management', async () => {
    const admin = await staff();
    const { owner } = await agency(admin);
    const { person } = await addAgent(owner, false);
    const next = await registered('Third');

    const res = await request(app)
      .post('/v1/agency/agents/invites')
      .set(auth(person))
      .send({ userId: next.publicId })
      .expect(403);
    expect(res.body.error.code).toBe('CANNOT_MANAGE_AGENTS');
    await request(app).get('/v1/agency/agents').set(auth(next)).expect(403);
  });

  it('refuses someone who already has a seat, or is a host somewhere', async () => {
    const admin = await staff();
    const a = await agency(admin, 'First');
    const b = await agency(admin, 'Second');
    const { person } = await addAgent(a.owner);

    const taken = await request(app)
      .post('/v1/agency/agents/invites')
      .set(auth(b.owner))
      .send({ userId: person.publicId })
      .expect(409);
    expect(taken.body.error.code).toBe('ALREADY_AN_AGENT');

    const host = await hostUnder(a.ownerAgentId, a.owner);
    const isHost = await request(app)
      .post('/v1/agency/agents/invites')
      .set(auth(b.owner))
      .send({ userId: host.publicId })
      .expect(409);
    expect(isHost.body.error.code).toBe('USER_IS_HOST');
  });

  it('allows one pending invite per agency, and the person may decline', async () => {
    const admin = await staff();
    const { owner } = await agency(admin);
    const person = await registered('Sub');

    const first = await request(app)
      .post('/v1/agency/agents/invites')
      .set(auth(owner))
      .send({ userId: person.publicId })
      .expect(201);
    const again = await request(app)
      .post('/v1/agency/agents/invites')
      .set(auth(owner))
      .send({ userId: person.publicId })
      .expect(409);
    expect(again.body.error.code).toBe('INVITE_ALREADY_PENDING');

    await request(app)
      .post(`/v1/agency/agents/invites/${first.body.invite.id}/decline`)
      .set(auth(person))
      .expect(200);
    expect((await request(app).get('/v1/agency/me').set(auth(person))).body.seat).toBeNull();
    // A declined invitation cannot then be accepted.
    await request(app)
      .post(`/v1/agency/agents/invites/${first.body.invite.id}/accept`)
      .set(auth(person))
      .expect(409);
  });

  it('is not answerable or even visible to anyone else', async () => {
    const admin = await staff();
    const { owner } = await agency(admin);
    const person = await registered('Sub');
    const outsider = await registered('Nosy');
    const invite = await request(app)
      .post('/v1/agency/agents/invites')
      .set(auth(owner))
      .send({ userId: person.publicId })
      .expect(201);

    const res = await request(app)
      .post(`/v1/agency/agents/invites/${invite.body.invite.id}/accept`)
      .set(auth(outsider))
      .expect(404);
    expect(res.body.error.code).toBe('INVITE_NOT_FOUND');
    expect(
      (await request(app).get('/v1/agency/agents/invites').set(auth(outsider))).body.mine,
    ).toHaveLength(0);
  });

  it('can be withdrawn by the agency', async () => {
    const admin = await staff();
    const { owner } = await agency(admin);
    const person = await registered('Sub');
    const invite = await request(app)
      .post('/v1/agency/agents/invites')
      .set(auth(owner))
      .send({ userId: person.publicId })
      .expect(201);

    await request(app)
      .post(`/v1/agency/agents/invites/${invite.body.invite.id}/cancel`)
      .set(auth(owner))
      .expect(200);
    await request(app)
      .post(`/v1/agency/agents/invites/${invite.body.invite.id}/accept`)
      .set(auth(person))
      .expect(409);
  });
});

describe('the roster', () => {
  it('lists the owner first, with each agent’s host count', async () => {
    const admin = await staff();
    const { owner, ownerAgentId } = await agency(admin);
    // The agent accepts their OWN applications — the owner cannot answer a
    // request addressed to a sub-agent.
    const { person, seat } = await addAgent(owner);
    await hostUnder(seat.publicId, person, 'One');
    await hostUnder(seat.publicId, person, 'Two');
    await hostUnder(ownerAgentId, owner, 'Three');

    const roster = await request(app).get('/v1/agency/agents').set(auth(owner)).expect(200);
    expect(roster.body.agents).toHaveLength(2);
    expect(roster.body.agents[0].isOwner).toBe(true);
    expect(roster.body.agents[0].hostCount).toBe(1);
    expect(roster.body.agents[1].hostCount).toBe(2);

    const hosts = await request(app)
      .get(`/v1/agency/agents/${seat.id}/hosts`)
      .set(auth(owner))
      .expect(200);
    expect(hosts.body.hosts).toHaveLength(2);
  });

  it('lets the owner grant and withdraw agent management, but not on themselves', async () => {
    const admin = await staff();
    const { owner, agencyId } = await agency(admin);
    const { seat } = await addAgent(owner);

    const granted = await request(app)
      .post(`/v1/agency/agents/${seat.id}/management`)
      .set(auth(owner))
      .send({ canManageAgents: true })
      .expect(200);
    expect(granted.body.agent.canManageAgents).toBe(true);

    await request(app)
      .post(`/v1/agency/agents/${seat.id}/management`)
      .set(auth(owner))
      .send({ canManageAgents: false })
      .expect(200);

    const { rows } = await pool.query('SELECT owner_agent_id FROM agencies WHERE id = $1', [
      agencyId,
    ]);
    await request(app)
      .post(`/v1/agency/agents/${rows[0].owner_agent_id}/management`)
      .set(auth(owner))
      .send({ canManageAgents: false })
      .expect(404);
  });
});

describe('removing an agent', () => {
  it('moves their hosts to the owner rather than stranding them', async () => {
    const admin = await staff();
    const { owner, ownerAgentId } = await agency(admin);
    const { person, seat } = await addAgent(owner);
    const host = await hostUnder(seat.publicId, person);

    const removed = await request(app)
      .post(`/v1/agency/agents/${seat.id}/remove`)
      .set(auth(owner))
      .expect(200);
    expect(removed.body).toMatchObject({ hostsMoved: 1 });

    // Still in the agency, now under the owner — and still earning.
    const me = await request(app).get('/v1/agency/me').set(auth(host)).expect(200);
    expect(me.body.membership.agency.name).toBe('Sur Talent');
    expect(me.body.membership.agent.publicId).toBe(ownerAgentId);

    // The old link is closed, not deleted: the first half of the month is
    // still attributable to the agent who actually held them.
    const { rows } = await pool.query(
      'SELECT effective_to FROM host_agent_assignments WHERE host_user_id = $1 ORDER BY effective_from',
      [host.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].effective_to).not.toBeNull();
    expect(rows[1].effective_to).toBeNull();

    // The removed person keeps no seat and no powers.
    expect((await request(app).get('/v1/agency/me').set(auth(person))).body.seat).toBeNull();
    await request(app).get('/v1/agency/agents').set(auth(person)).expect(403);
  });

  it('refuses to remove the owner', async () => {
    const admin = await staff();
    const { owner, agencyId } = await agency(admin);
    const { rows } = await pool.query('SELECT owner_agent_id FROM agencies WHERE id = $1', [
      agencyId,
    ]);

    const res = await request(app)
      .post(`/v1/agency/agents/${rows[0].owner_agent_id}/remove`)
      .set(auth(owner))
      .expect(409);
    expect(res.body.error.code).toBe('CANNOT_REMOVE_OWNER');
  });

  it('refuses an agent from another agency', async () => {
    const admin = await staff();
    const a = await agency(admin, 'First');
    const b = await agency(admin, 'Second');
    const { seat } = await addAgent(a.owner);

    const res = await request(app)
      .post(`/v1/agency/agents/${seat.id}/remove`)
      .set(auth(b.owner))
      .expect(404);
    expect(res.body.error.code).toBe('AGENT_NOT_IN_AGENCY');
  });

  it('frees the person to be invited again', async () => {
    const admin = await staff();
    const a = await agency(admin, 'First');
    const b = await agency(admin, 'Second');
    const { person, seat } = await addAgent(a.owner);
    await request(app).post(`/v1/agency/agents/${seat.id}/remove`).set(auth(a.owner)).expect(200);

    const invite = await request(app)
      .post('/v1/agency/agents/invites')
      .set(auth(b.owner))
      .send({ userId: person.publicId })
      .expect(201);
    await request(app)
      .post(`/v1/agency/agents/invites/${invite.body.invite.id}/accept`)
      .set(auth(person))
      .expect(200);
    const me = await request(app).get('/v1/agency/me').set(auth(person)).expect(200);
    expect(me.body.seat.agency.name).toBe('Second');
  });
});

describe('the back office', () => {
  it('lists and searches agencies, with their counts and stock', async () => {
    const admin = await staff();
    const { owner, agencyPublicId } = await agency(admin, 'Sur Talent');
    await addAgent(owner);
    await agency(admin, 'Other Agency');

    const all = await request(app).get('/v1/admin/agencies').set(auth(admin)).expect(200);
    expect(all.body.agencies.length).toBeGreaterThanOrEqual(2);

    const found = await request(app).get('/v1/admin/agencies?q=Sur').set(auth(admin)).expect(200);
    expect(found.body.agencies).toHaveLength(1);
    expect(found.body.agencies[0]).toMatchObject({
      publicId: agencyPublicId,
      agentCount: 2,
      inventoryCoins: 0,
      coinTradingEnabled: false,
    });
  });

  it('shows one agency in full', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    await hostUnder(ownerAgentId, owner);

    const res = await request(app)
      .get(`/v1/admin/agencies/${agencyId}`)
      .set(auth(admin))
      .expect(200);
    expect(res.body.agency).toMatchObject({ hostCount: 1, status: 'active' });
    expect(res.body.agency.prepaid).toMatchObject({ confirmedPaise: 0, pendingCount: 0 });
    expect(res.body.agency.statusHistory).toEqual([]);
  });

  it('suspends an agency, which stops it trading and recruiting at once', async () => {
    const admin = await staff();
    const { owner, agencyId } = await agency(admin);
    await request(app)
      .post(`/v1/admin/agencies/${agencyId}/coin-trading`)
      .set(auth(admin))
      .send({ enabled: true })
      .expect(200);

    await request(app)
      .post(`/v1/admin/agencies/${agencyId}/status`)
      .set(auth(admin))
      .send({ status: 'suspended', reason: 'Payment complaints from three users' })
      .expect(200);

    // Every power the seat conferred is gone in one move.
    await request(app).get('/v1/agency/inventory').set(auth(owner)).expect(403);
    await request(app).get('/v1/agency/agents').set(auth(owner)).expect(403);
    expect((await request(app).get('/v1/agency/me').set(auth(owner))).body.seat).toBeNull();

    const detail = await request(app)
      .get(`/v1/admin/agencies/${agencyId}`)
      .set(auth(admin))
      .expect(200);
    expect(detail.body.agency.status).toBe('suspended');
    expect(detail.body.agency.statusHistory[0]).toMatchObject({
      fromStatus: 'active',
      toStatus: 'suspended',
    });
  });

  it('keeps a suspended agency’s hosts earning, and can reinstate it', async () => {
    const admin = await staff();
    const { owner, agencyId, ownerAgentId } = await agency(admin);
    const host = await hostUnder(ownerAgentId, owner);

    await request(app)
      .post(`/v1/admin/agencies/${agencyId}/status`)
      .set(auth(admin))
      .send({ status: 'suspended', reason: 'Under review' })
      .expect(200);

    // The host joined an agency, not its conduct. They stay attached.
    const me = await request(app).get('/v1/agency/me').set(auth(host)).expect(200);
    expect(me.body.membership).not.toBeNull();

    await request(app)
      .post(`/v1/admin/agencies/${agencyId}/status`)
      .set(auth(admin))
      .send({ status: 'active', reason: 'Complaints resolved' })
      .expect(200);
    const back = await request(app).get('/v1/agency/me').set(auth(owner)).expect(200);
    expect(back.body.seat).not.toBeNull();

    const detail = await request(app)
      .get(`/v1/admin/agencies/${agencyId}`)
      .set(auth(admin))
      .expect(200);
    expect(detail.body.agency.suspendedReason).toBeNull();
    expect(detail.body.agency.statusHistory).toHaveLength(2);
  });

  it('refuses a no-op change and will not reopen a closed agency', async () => {
    const admin = await staff();
    const { agencyId } = await agency(admin);

    const same = await request(app)
      .post(`/v1/admin/agencies/${agencyId}/status`)
      .set(auth(admin))
      .send({ status: 'active', reason: 'nothing to do' })
      .expect(409);
    expect(same.body.error.code).toBe('STATUS_UNCHANGED');

    await request(app)
      .post(`/v1/admin/agencies/${agencyId}/status`)
      .set(auth(admin))
      .send({ status: 'closed', reason: 'Relationship ended' })
      .expect(200);
    const reopen = await request(app)
      .post(`/v1/admin/agencies/${agencyId}/status`)
      .set(auth(admin))
      .send({ status: 'active', reason: 'Changed our mind' })
      .expect(409);
    expect(reopen.body.error.code).toBe('AGENCY_CLOSED');
  });

  it('is staff only, all of it', async () => {
    const admin = await staff();
    const { owner, agencyId } = await agency(admin);
    for (const path of [
      '/v1/admin/agencies',
      '/v1/admin/agencies/transfers',
      `/v1/admin/agencies/${agencyId}`,
    ]) {
      await request(app).get(path).set(auth(owner)).expect(404);
    }
  });
});
