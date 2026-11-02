// Build-plan M21 slice 6: limits that hold across instances, and no staff
// account with a password anyone could guess.

import { execFileSync } from 'child_process';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditStaffCredentials } from '../src/admin/staffAudit.js';
import { resetAlertCooldowns, setAlertTransport, transportsFromConfig, type Alert } from '../src/infra/alerts.js';
import { pool } from '../src/infra/db.js';
import { redis } from '../src/infra/redis.js';
import { RedisRateLimitStore, type RedisLike } from '../src/middleware/rateLimit.js';
import { hashPassword, verifyPassword } from '../src/modules/auth/password.js';
import { closePool, resetLedger } from './helpers.js';

const silence = () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
};

beforeEach(async () => {
  await resetLedger();
  resetAlertCooldowns();
});

afterEach(() => {
  vi.restoreAllMocks();
  setAlertTransport(transportsFromConfig());
});

afterAll(async () => {
  await closePool();
});

describe('rate limits in Redis', () => {
  const prefix = `rl-test-${uuidv7()}:`;
  // Two stores over one Redis: two API instances behind the load balancer.
  const a = new RedisRateLimitStore(redis, prefix);
  const b = new RedisRateLimitStore(redis, prefix);

  afterEach(async () => {
    await a.clear();
  });

  it('counts across instances, so two API hosts do not double a limit', async () => {
    expect((await a.hit('otp:+919900000000', 60_000)).count).toBe(1);
    expect((await b.hit('otp:+919900000000', 60_000)).count).toBe(2);
    const third = await a.hit('otp:+919900000000', 60_000);
    expect(third.count).toBe(3);
    expect(third.resetAt).toBeGreaterThan(Date.now() + 55_000);
  });

  it('expires the window, and a released hit is given back', async () => {
    await a.hit('k', 200);
    await a.hit('k', 200);
    await b.release('k');
    expect((await a.hit('k', 200)).count).toBe(2);
    await new Promise((r) => setTimeout(r, 300));
    expect((await b.hit('k', 200)).count).toBe(1);
  });

  it('never lets a counter go below zero', async () => {
    await a.release('never-hit');
    expect((await a.hit('never-hit', 60_000)).count).toBe(1);
  });

  it('clear drops its own keys and nothing else', async () => {
    await redis.set('not-a-limit', 'keep', 'EX', 60);
    await a.hit('x', 60_000);
    await a.clear();
    expect(await redis.get(`${prefix}x`)).toBeNull();
    expect(await redis.get('not-a-limit')).toBe('keep');
    await redis.del('not-a-limit');
  });

  it('falls back to limiting per process when Redis does not answer', async () => {
    silence();
    const broken: RedisLike = {
      eval: async () => Promise.reject(new Error('ECONNREFUSED')),
      scan: async () => ['0', []],
      del: async () => 0,
    };
    const store = new RedisRateLimitStore(broken, prefix);
    expect((await store.hit('y', 60_000)).count).toBe(1);
    expect((await store.hit('y', 60_000)).count).toBe(2);
    await expect(store.release('y')).resolves.toBeUndefined();
  });
});

async function staffUser(password: string, role = 'ops_manager', revoked = false): Promise<string> {
  const id = uuidv7();
  await pool.query("INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, $3, 'active')", [
    id,
    `audit-${id}@example.com`,
    await hashPassword(password),
  ]);
  await pool.query(
    `INSERT INTO role_assignments (id, user_id, role_code, scope_type, revoked_at)
     VALUES ($1, $2, $3, 'global', $4)`,
    [uuidv7(), id, role, revoked ? new Date() : null],
  );
  return id;
}

describe('the staff credential audit', () => {
  it('pages on a staff account with a known password, naming the account and never the password', async () => {
    silence();
    const sent: Alert[] = [];
    setAlertTransport({ name: 'test', send: async (a) => void sent.push(a) });

    const weak = await staffUser('admin-dev-password');
    await staffUser('a-long-generated-password-nobody-guesses');
    await staffUser('password', 'ops_manager', true); // revoked: no longer staff

    // A short candidate list keeps the test fast; the real one is longer.
    const result = await auditStaffCredentials(['admin-dev-password', 'password']);
    expect(result.checked).toBe(2);
    expect(result.weak).toEqual([{ userId: weak, roles: ['ops_manager'] }]);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ severity: 'page', key: 'staff_known_password' });
    expect(String(sent[0].detail?.accounts)).toContain(weak);
    expect(JSON.stringify(sent[0])).not.toContain('admin-dev-password');
  });

  it('is quiet when every staff password is generated', async () => {
    silence();
    const sent: Alert[] = [];
    setAlertTransport({ name: 'test', send: async (a) => void sent.push(a) });
    await staffUser('a-long-generated-password-nobody-guesses');
    expect((await auditStaffCredentials(['admin-dev-password'])).weak).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});

describe('scripts/staff.ts', () => {
  const run = (...args: string[]) =>
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/staff.ts', ...args], {
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  it('creates staff with a generated password, resets it, and revokes by setting revoked_at', async () => {
    const address = `ops-${uuidv7()}@example.com`;

    const created = run('create', '--email', address, '--name', 'Ops', '--role', 'ops_manager');
    const password = /Password .*: (\S+)$/m.exec(created)?.[1] ?? '';
    expect(password.length).toBeGreaterThanOrEqual(24);

    const { rows } = await pool.query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [address],
    );
    expect(await verifyPassword(password, rows[0].password_hash)).toBe(true);
    expect(run('list')).toContain(address);

    // Running create again grants nothing new and keeps the password.
    expect(run('create', '--email', address, '--name', 'Ops', '--role', 'ops_manager')).toContain('Password unchanged');

    const reset = run('reset', '--email', address);
    const next = /: (\S+)$/m.exec(reset)?.[1] ?? '';
    expect(next).not.toBe(password);

    expect(run('revoke', '--email', address, '--role', 'ops_manager', '--reason', 'test')).toContain('Revoked');
    const role = await pool.query('SELECT revoked_at, reason FROM role_assignments WHERE user_id = $1', [rows[0].id]);
    expect(role.rows).toHaveLength(1);
    expect(role.rows[0].revoked_at).not.toBeNull();
    expect(run('list')).not.toContain(address);
  }, 60_000);

  it('refuses a role that is not a staff role', () => {
    expect(() => run('create', '--email', 'x@example.com', '--name', 'X', '--role', 'host')).toThrow();
  });
});

describe('overload fails as a retryable 503, never a 500', () => {
  it('maps the pool running out of connections', async () => {
    const { mapDatabaseError } = await import('../src/infra/errors.js');
    const timeout = mapDatabaseError(new Error('timeout exceeded when trying to connect'));
    expect(timeout).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
    expect(timeout?.expose).toBe(true);
    expect(mapDatabaseError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })))
      .toMatchObject({ status: 503 });
    // An ordinary error is still not the database's to claim.
    expect(mapDatabaseError(new Error('something else'))).toBeUndefined();
  });
});
