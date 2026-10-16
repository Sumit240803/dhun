import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { escapeHtml, html, raw, safeUrl } from '../src/admin/html.js';
import { pool } from '../src/infra/db.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { LiveKitProvider } from '../src/modules/realtime/livekit.provider.js';
import { enforce, recentEnforcement } from '../src/modules/verification/index.js';
import { closePool, resetLedger } from './helpers.js';

const app = buildApp();
const DEVICE = { deviceId: 'admin-device-01', platform: 'android' };

let counter = 0;
const nextEmail = () => `staff${counter++}.${Date.now()}@example.com`;
const nextPhone = () => `+9199${String(60_000_000 + counter++).slice(-8)}`;

/** A user holding one of the staff roles, plus their password. */
async function staff(role = 'super_admin'): Promise<{ id: string; email: string; password: string }> {
  const email = nextEmail();
  const password = 'correct horse battery staple';
  const id = uuidv7();

  await pool.query(
    "INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, $3, 'active')",
    [id, email, await hashPassword(password)],
  );
  await pool.query("INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Ops')", [id]);
  await pool.query(
    `INSERT INTO role_assignments (id, user_id, role_code, scope_type)
          VALUES ($1, $2, $3, 'global')`,
    [uuidv7(), id, role],
  );
  return { id, email, password };
}

/** An ordinary signed-up user with no staff role. */
async function civilian(): Promise<{ id: string; email: string; password: string }> {
  const email = nextEmail();
  const password = 'correct horse battery staple';
  const id = uuidv7();
  await pool.query(
    "INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, $3, 'active')",
    [id, email, await hashPassword(password)],
  );
  await pool.query("INSERT INTO user_profiles (user_id, display_name) VALUES ($1, 'Asha')", [id]);
  return { id, email, password };
}

/** Signs in and returns the session cookie. */
async function signIn(who: { email: string; password: string }): Promise<string | null> {
  const res = await request(app)
    .post('/admin/login')
    .type('form')
    .send({ email: who.email, password: who.password });

  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  return cookies?.find((c) => c.startsWith('dhun_admin='))?.split(';')[0] ?? null;
}

/** The CSRF token out of a rendered page. */
function csrfFrom(body: string): string {
  return /name="csrf" value="([^"]+)"/.exec(body)?.[1] ?? '';
}

beforeEach(async () => {
  await resetLedger();
  vi.spyOn(LiveKitProvider.prototype, 'closeRoom').mockResolvedValue();
});

afterEach(() => vi.restoreAllMocks());
afterAll(closePool);

describe('the escaping primitive', () => {
  it('escapes every interpolation by default', () => {
    const evil = '<script>alert(1)</script>';
    expect(html`<p>${evil}</p>`.value).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('escapes quotes, so an attribute cannot be broken out of', () => {
    // `<a title="${x}">` with x = `" onmouseover="evil` is the attack this stops.
    expect(escapeHtml(`" onmouseover="x`)).toBe('&quot; onmouseover=&quot;x');
    expect(escapeHtml(`' onfocus='x`)).toBe('&#39; onfocus=&#39;x');
  });

  it('only lets markup through when raw() is spelled out', () => {
    expect(html`${raw('<b>ok</b>')}`.value).toBe('<b>ok</b>');
  });

  it('escapes inside nested templates and arrays', () => {
    // The dangerous case: a SafeHtml passes through, but a plain string inside
    // one must still be escaped when it was interpolated.
    const rows = ['<img onerror=x>', 'fine'];
    const out = html`<ul>${rows.map((r) => html`<li>${r}</li>`)}</ul>`.value;
    expect(out).toBe('<ul><li>&lt;img onerror=x&gt;</li><li>fine</li></ul>');
  });

  it('refuses a javascript: url', () => {
    // An attacker-supplied image or link URL is the one place a stored string
    // reaches an attribute that can execute.
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>')).toBe('#');
    expect(safeUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(safeUrl(null)).toBe('#');
  });
});

describe('getting in', () => {
  it('lets staff sign in and reach the queue', async () => {
    const cookie = await signIn(await staff());
    expect(cookie).not.toBeNull();

    const res = await request(app).get('/admin/queue').set('Cookie', cookie!).expect(200);
    expect(res.text).toContain('Review queue');
  });

  it('refuses a real user who is not staff', async () => {
    // Correct password, no role. The panel must not open.
    const res = await request(app)
      .post('/admin/login')
      .type('form')
      .send(await civilian().then((u) => ({ email: u.email, password: u.password })));

    expect(res.headers.location).toContain('/admin/login?error=');
    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(cookies?.some((c) => c.startsWith('dhun_admin='))).not.toBe(true);
  });

  it('says the same thing for a wrong password and an unknown account', async () => {
    // Telling them apart is an account enumeration oracle on the back office's
    // front door.
    const who = await staff();
    const wrongPassword = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ email: who.email, password: 'not it' });
    const noAccount = await request(app)
      .post('/admin/login')
      .type('form')
      .send({ email: 'nobody@example.com', password: 'not it' });

    expect(wrongPassword.headers.location).toBe(noAccount.headers.location);
  });

  it('sends anybody without a session to the sign-in page', async () => {
    for (const path of ['/admin/queue', '/admin/rooms', '/admin/users', '/admin/log']) {
      const res = await request(app).get(path).expect(302);
      expect(res.headers.location).toBe('/admin/login');
    }
  });

  it('scopes the cookie to /admin and keeps it from JavaScript', async () => {
    const res = await request(app)
      .post('/admin/login')
      .type('form')
      .send(await staff().then((u) => ({ email: u.email, password: u.password })));

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('dhun_admin='),
    )!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    // Never sent to /v1, so an admin session cannot be replayed against the API.
    expect(cookie).toContain('Path=/admin');
  });

  it('drops the session the moment the role is revoked', async () => {
    // The cookie proves WHO; the database decides WHAT. A moderator whose
    // access was pulled an hour ago must not keep it until expiry.
    const who = await staff();
    const cookie = await signIn(who);
    await request(app).get('/admin/queue').set('Cookie', cookie!).expect(200);

    await pool.query('UPDATE role_assignments SET revoked_at = now() WHERE user_id = $1', [who.id]);

    const after = await request(app).get('/admin/queue').set('Cookie', cookie!).expect(302);
    expect(after.headers.location).toBe('/admin/login');
  });
});

describe('CSRF', () => {
  it('refuses a POST with no token', async () => {
    const cookie = await signIn(await staff());
    await request(app)
      .post('/admin/users/action')
      .set('Cookie', cookie!)
      .type('form')
      .send({ action: 'flag', userId: uuidv7() })
      .expect(403);
  });

  it('refuses a token from somebody else’s session', async () => {
    const [a, b] = [await staff(), await staff()];
    const [cookieA, cookieB] = [await signIn(a), await signIn(b)];

    const pageB = await request(app).get('/admin/users').set('Cookie', cookieB!).expect(200);
    const theirToken = csrfFrom(pageB.text);

    await request(app)
      .post('/admin/users/action')
      .set('Cookie', cookieA!)
      .type('form')
      .send({ action: 'flag', userId: a.id, csrf: theirToken })
      .expect(403);
  });
});

describe('what a moderator may do', () => {
  it('lets a lead suspend, and stops a content moderator', async () => {
    // Flagging is reversible and invisible; suspending stops somebody earning.
    const target = await civilian();

    // The token must come from a page that HAS one. `/admin/users` with no
    // query renders only the search form, which is a GET and carries none —
    // taking it from there made this assert a CSRF rejection while claiming to
    // assert a role one.
    const moderator = await signIn(await staff('content_moderator'));
    const modPage = await request(app)
      .get(`/admin/users/${target.id}`)
      .set('Cookie', moderator!)
      .expect(200);

    await request(app)
      .post('/admin/users/action')
      .set('Cookie', moderator!)
      .type('form')
      .send({ action: 'suspend', userId: target.id, csrf: csrfFrom(modPage.text) })
      .expect(403);

    // And it was the ROLE that refused it, not a missing token.
    expect(csrfFrom(modPage.text)).not.toBe('');

    const lead = await signIn(await staff('ts_lead'));
    const leadPage = await request(app)
      .get(`/admin/users/${target.id}`)
      .set('Cookie', lead!)
      .expect(200);

    await request(app)
      .post('/admin/users/action')
      .set('Cookie', lead!)
      .type('form')
      .send({ action: 'suspend', userId: target.id, csrf: csrfFrom(leadPage.text) })
      .expect(302);

    const { rows } = await pool.query('SELECT host_suspended_at FROM users WHERE id = $1', [
      target.id,
    ]);
    expect(rows[0].host_suspended_at).not.toBeNull();
  });

  it('escapes a hostile display name rather than rendering it', async () => {
    // THE test for this panel. An XSS here is script running in a session that
    // can suspend accounts and read every host's photo.
    const target = await civilian();
    await pool.query('UPDATE user_profiles SET display_name = $2 WHERE user_id = $1', [
      target.id,
      '<script>alert(1)</script>',
    ]);

    const cookie = await signIn(await staff());
    const res = await request(app)
      .get(`/admin/users/${target.id}`)
      .set('Cookie', cookie!)
      .expect(200);

    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('the enforcement log', () => {
  it('records who did what, and cannot be rewritten', async () => {
    const actor = await staff();
    const target = await civilian();

    await enforce({
      actorId: actor.id,
      action: 'flag',
      subjectType: 'user',
      subjectId: target.id,
      source: 'manual',
      note: 'looked wrong',
    });

    const log = await recentEnforcement(10);
    const entry = log.find((e) => e.subjectId === target.id);
    expect(entry?.action).toBe('flag');
    expect(entry?.note).toBe('looked wrong');

    // Append-only by trigger. An enforcement log that can be edited is not
    // evidence, and the appeal flow depends on it.
    await expect(
      pool.query("UPDATE enforcement_actions SET note = 'tampered' WHERE id = $1", [entry!.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query('DELETE FROM enforcement_actions WHERE id = $1', [entry!.id]),
    ).rejects.toThrow(/append-only/);
  });

  it('writes the state change and the log entry together', async () => {
    const actor = await staff();
    const target = await civilian();

    await enforce({
      actorId: actor.id,
      action: 'suspend',
      subjectType: 'user',
      subjectId: target.id,
      source: 'face_check',
    });

    const user = await pool.query('SELECT host_suspended_at FROM users WHERE id = $1', [target.id]);
    const log = await pool.query(
      "SELECT 1 FROM enforcement_actions WHERE subject_id = $1 AND action = 'suspend'",
      [target.id],
    );

    // A suspension with no log entry is an action nobody can be asked about;
    // a log entry with no suspension is a lie.
    expect(user.rows[0].host_suspended_at).not.toBeNull();
    expect(log.rowCount).toBe(1);
  });
});

describe('the policy the panel states for itself', () => {
  it('allows its own stylesheet and no script at all', async () => {
    // The API's own policy is `default-src 'none'`, which would leave the
    // panel with no stylesheet and no face images — the entire point of the
    // review queue. It states a tighter one of its own instead.
    const res = await request(app).get('/admin/login').expect(200);
    const csp = res.headers['content-security-policy'];

    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
  });
});
