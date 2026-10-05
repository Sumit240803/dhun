// Agency membership over HTTP: admin creation, both join routes, no poaching,
// and every quitting rule the founder set (build-plan M12 "Membership rules").
import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/infra/db.js';
import { autoLeaveOverdue } from '../src/modules/agency/index.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();
let phoneCounter = 0;
const nextPhone = () => `+9193${String(60_000_000 + phoneCounter++).slice(-8)}`;

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
      device: { deviceId: `ag-${randomUUID()}`, platform: 'android' },
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

/** An agency with its owner; returns the owner and their Agent ID. */
async function agency(admin: User, name = 'Sur Talent') {
  const owner = await registered('Owner');
  const res = await request(app)
    .post('/v1/admin/agencies')
    .set(auth(admin))
    .send({ ownerUserId: owner.publicId, name })
    .expect(201);
  return {
    owner,
    agentId: res.body.ownerSeat.publicId as number,
    agencyId: res.body.agency.id as string,
  };
}

async function joinViaAgentId(host: User, owner: User, agentId: number) {
  const applied = await request(app)
    .post('/v1/agency/join')
    .set(auth(host))
    .send({ agentId })
    .expect(201);
  await request(app)
    .post(`/v1/agency/requests/${applied.body.request.id}/accept`)
    .set(auth(owner))
    .expect(200);
}

/** Moves a host's join back in time and marks face auth attempted, so quits need a decision. */
async function makeEstablished(host: User) {
  await pool.query(
    "UPDATE host_agent_assignments SET effective_from = now() - interval '10 days' WHERE host_user_id = $1 AND effective_to IS NULL",
    [host.id],
  );
  await pool.query('UPDATE users SET face_auth_attempted_at = now() WHERE id = $1', [host.id]);
}

beforeEach(resetLedger);
afterAll(closePool);

describe('creating an agency', () => {
  it('is staff only, and hidden from everyone else', async () => {
    const user = await registered();
    await request(app)
      .post('/v1/admin/agencies')
      .set(auth(user))
      .send({ ownerUserId: user.publicId, name: 'Mine' })
      .expect(404);
  });

  it('gives the owner an agent seat that can manage agents', async () => {
    const admin = await staff();
    const { owner } = await agency(admin);
    const me = await request(app).get('/v1/agency/me').set(auth(owner)).expect(200);
    expect(me.body.seat).toMatchObject({
      isOwner: true,
      canManageAgents: true,
    });
    expect(me.body.membership).toBeNull();
  });

  it('allows exactly one in-house agency', async () => {
    const admin = await staff();
    const a = await registered();
    const b = await registered();
    await request(app)
      .post('/v1/admin/agencies')
      .set(auth(admin))
      .send({ ownerUserId: a.publicId, name: 'Dhun Official', isHouse: true })
      .expect(201);
    const res = await request(app)
      .post('/v1/admin/agencies')
      .set(auth(admin))
      .send({ ownerUserId: b.publicId, name: 'Second', isHouse: true })
      .expect(409);
    expect(res.body.error.code).toBe('HOUSE_AGENCY_EXISTS');
  });
});

describe('joining', () => {
  it('route 1: host applies with an Agent ID, the agent accepts', async () => {
    const admin = await staff();
    const { owner, agentId } = await agency(admin);
    const host = await registered('Sunita');
    await joinViaAgentId(host, owner, agentId);

    const me = await request(app).get('/v1/agency/me').set(auth(host)).expect(200);
    expect(me.body.membership.agency.name).toBe('Sur Talent');
    expect(me.body.membership.owner.publicId).toBe(owner.publicId);
  });

  it('route 2: the agent invites with User ID + Host Code, the host accepts', async () => {
    const admin = await staff();
    const { owner } = await agency(admin);
    const host = await registered('Sunita');
    const code = await request(app).get('/v1/agency/host-code').set(auth(host)).expect(200);

    const invite = await request(app)
      .post('/v1/agency/invites')
      .set(auth(owner))
      .send({ userId: host.publicId, hostCode: code.body.code.toLowerCase() })
      .expect(201);
    // The agent cannot accept their own invite.
    await request(app)
      .post(`/v1/agency/requests/${invite.body.request.id}/accept`)
      .set(auth(owner))
      .expect(404);
    await request(app)
      .post(`/v1/agency/requests/${invite.body.request.id}/accept`)
      .set(auth(host))
      .expect(200);
  });

  it('gives the same answer for a wrong code and an unknown user', async () => {
    const admin = await staff();
    const { owner } = await agency(admin);
    const host = await registered();
    await request(app).get('/v1/agency/host-code').set(auth(host)).expect(200);

    const wrongCode = await request(app)
      .post('/v1/agency/invites')
      .set(auth(owner))
      .send({ userId: host.publicId, hostCode: 'ZZZZZZ' })
      .expect(404);
    const noUser = await request(app)
      .post('/v1/agency/invites')
      .set(auth(owner))
      .send({ userId: 99_999_998, hostCode: 'ZZZZZZ' })
      .expect(404);
    const shape = (e: { code: string; message: string }) => ({
      code: e.code,
      message: e.message,
    });
    expect(shape(wrongCode.body.error)).toEqual(shape(noUser.body.error));
  });

  it('stops working the old code once rotated', async () => {
    const admin = await staff();
    const { owner } = await agency(admin);
    const host = await registered();
    const old = await request(app).get('/v1/agency/host-code').set(auth(host)).expect(200);
    await request(app).post('/v1/agency/host-code/rotate').set(auth(host)).expect(200);
    await request(app)
      .post('/v1/agency/invites')
      .set(auth(owner))
      .send({ userId: host.publicId, hostCode: old.body.code })
      .expect(404);
  });

  it('refuses a host already in an agency — no poaching', async () => {
    const admin = await staff();
    const first = await agency(admin, 'First');
    const second = await agency(admin, 'Second');
    const host = await registered();
    await joinViaAgentId(host, first.owner, first.agentId);

    const apply = await request(app)
      .post('/v1/agency/join')
      .set(auth(host))
      .send({ agentId: second.agentId })
      .expect(409);
    expect(apply.body.error.code).toBe('ALREADY_IN_AGENCY');

    const code = await request(app).get('/v1/agency/host-code').set(auth(host)).expect(200);
    const invite = await request(app)
      .post('/v1/agency/invites')
      .set(auth(second.owner))
      .send({ userId: host.publicId, hostCode: code.body.code })
      .expect(409);
    expect(invite.body.error.code).toBe('HOST_IN_AGENCY');
  });

  it('cancels a host’s other applications once one is accepted', async () => {
    const admin = await staff();
    const first = await agency(admin, 'First');
    const second = await agency(admin, 'Second');
    const host = await registered();
    const a = await request(app)
      .post('/v1/agency/join')
      .set(auth(host))
      .send({ agentId: first.agentId })
      .expect(201);
    const b = await request(app)
      .post('/v1/agency/join')
      .set(auth(host))
      .send({ agentId: second.agentId })
      .expect(201);
    await request(app)
      .post(`/v1/agency/requests/${a.body.request.id}/accept`)
      .set(auth(first.owner))
      .expect(200);
    const late = await request(app)
      .post(`/v1/agency/requests/${b.body.request.id}/accept`)
      .set(auth(second.owner))
      .expect(409);
    expect(late.body.error.code).toBe('REQUEST_CLOSED');
  });

  it('refuses joining your own agent seat', async () => {
    const admin = await staff();
    const { owner, agentId } = await agency(admin);
    const res = await request(app)
      .post('/v1/agency/join')
      .set(auth(owner))
      .send({ agentId })
      .expect(400);
    expect(res.body.error.code).toBe('CANNOT_JOIN_SELF');
  });
});

describe('quitting', () => {
  async function hostInAgency() {
    const admin = await staff();
    const ag = await agency(admin);
    const host = await registered('Sunita');
    await joinViaAgentId(host, ag.owner, ag.agentId);
    return { ...ag, host, admin };
  }

  const quit = (host: User, reason = 'Moving on') =>
    request(app).post('/v1/agency/quit').set(auth(host)).send({ reason });

  it('rule 2: a host who never attempted face auth leaves at once', async () => {
    const { host } = await hostInAgency();
    await pool.query(
      "UPDATE host_agent_assignments SET effective_from = now() - interval '10 days' WHERE host_user_id = $1",
      [host.id],
    );
    const res = await quit(host).expect(200);
    expect(res.body.outcome).toBe('left');
    expect(res.body.request.status).toBe('direct');
  });

  it('rule 3: a host who joined under a day ago leaves at once', async () => {
    const { host } = await hostInAgency();
    await pool.query('UPDATE users SET face_auth_attempted_at = now() WHERE id = $1', [host.id]);
    expect((await quit(host).expect(200)).body.outcome).toBe('left');
  });

  it('otherwise waits on the owner, who may approve', async () => {
    const { host, owner } = await hostInAgency();
    await makeEstablished(host);
    const res = await quit(host).expect(200);
    expect(res.body.outcome).toBe('pending');
    expect(res.body.request.autoLeaveAt).toBeTruthy();

    const inbox = await request(app).get('/v1/agency/quit-requests').set(auth(owner)).expect(200);
    expect(inbox.body.requests).toHaveLength(1);
    await request(app)
      .post(`/v1/agency/quit-requests/${res.body.request.id}/approve`)
      .set(auth(owner))
      .expect(200);
    expect((await request(app).get('/v1/agency/me').set(auth(host))).body.membership).toBeNull();
  });

  it('only the agency owner decides — not a stranger, not the host', async () => {
    const { host, admin } = await hostInAgency();
    await makeEstablished(host);
    const res = await quit(host).expect(200);
    const other = await agency(admin, 'Other');
    for (const u of [other.owner, host]) {
      const r = await request(app)
        .post(`/v1/agency/quit-requests/${res.body.request.id}/approve`)
        .set(auth(u))
        .expect(403);
      expect(r.body.error.code).toBe('NOT_AGENCY_OWNER');
    }
  });

  it('rule 5: a rejection can still be approved within 14 days, not after', async () => {
    const { host, owner } = await hostInAgency();
    await makeEstablished(host);
    const { body } = await quit(host).expect(200);
    const id = body.request.id;

    const rejected = await request(app)
      .post(`/v1/agency/quit-requests/${id}/reject`)
      .set(auth(owner))
      .expect(200);
    expect(rejected.body.request.approvableUntil).toBeTruthy();
    // Cannot reject twice.
    await request(app).post(`/v1/agency/quit-requests/${id}/reject`).set(auth(owner)).expect(409);

    await pool.query(
      "UPDATE agency_quit_requests SET rejected_at = now() - interval '15 days' WHERE id = $1",
      [id],
    );
    const late = await request(app)
      .post(`/v1/agency/quit-requests/${id}/approve`)
      .set(auth(owner))
      .expect(409);
    expect(late.body.error.code).toBe('QUIT_DECISION_CLOSED');

    await pool.query(
      "UPDATE agency_quit_requests SET rejected_at = now() - interval '13 days' WHERE id = $1",
      [id],
    );
    await request(app).post(`/v1/agency/quit-requests/${id}/approve`).set(auth(owner)).expect(200);
  });

  it('rule 4: one application per 30 days, approved or declined', async () => {
    const { host, owner } = await hostInAgency();
    await makeEstablished(host);
    const { body } = await quit(host).expect(200);
    await request(app)
      .post(`/v1/agency/quit-requests/${body.request.id}/reject`)
      .set(auth(owner))
      .expect(200);

    const again = await quit(host).expect(409);
    expect(again.body.error.code).toBe('QUIT_COOLDOWN');
    expect(again.body.error.details.nextAllowedAt).toBeTruthy();

    await pool.query(
      "UPDATE agency_quit_requests SET created_at = now() - interval '31 days' WHERE id = $1",
      [body.request.id],
    );
    expect((await quit(host).expect(200)).body.outcome).toBe('pending');
  });

  it('rule 1: seven days undecided and the host leaves on their own', async () => {
    const { host } = await hostInAgency();
    await makeEstablished(host);
    const { body } = await quit(host).expect(200);

    expect(await autoLeaveOverdue()).toBe(0);
    await pool.query(
      "UPDATE agency_quit_requests SET created_at = now() - interval '7 days 1 minute' WHERE id = $1",
      [body.request.id],
    );
    expect(await autoLeaveOverdue()).toBe(1);

    const me = await request(app).get('/v1/agency/me').set(auth(host)).expect(200);
    expect(me.body.membership).toBeNull();
    expect(me.body.quitRequest.status).toBe('auto_left');
  });

  it('rejects a reason over 100 characters, and a quit from outside any agency', async () => {
    const { host } = await hostInAgency();
    await quit(host, 'x'.repeat(101)).expect(422);
    const loner = await registered();
    expect((await quit(loner).expect(409)).body.error.code).toBe('NOT_IN_AGENCY');
  });

  it('can rejoin another agency after leaving', async () => {
    const { host, admin } = await hostInAgency();
    await quit(host).expect(200); // never face-authed → leaves at once
    const next = await agency(admin, 'Next');
    await joinViaAgentId(host, next.owner, next.agentId);
    const me = await request(app).get('/v1/agency/me').set(auth(host)).expect(200);
    expect(me.body.membership.agency.name).toBe('Next');
  });
});
