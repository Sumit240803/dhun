// The shell every admin page renders into.
//
// Plain HTML and one inline stylesheet. No build step, no framework, no
// bundler — the panel deploys with the API because it IS the API, which is
// most of why it was built this way: one thing to deploy, one auth system, one
// set of modules, and no second frontend to keep alive before there is a first
// user.
//
// It is a back office for two or three people. It needs to be fast, legible,
// and impossible to get wrong at 11pm; it does not need to be pretty.

import { html, type Renderable, type SafeHtml } from './html.js';

export interface Nav {
  /** Which tab is current. */
  active: 'queue' | 'reports' | 'rooms' | 'users' | 'agencies' | 'catalog' | 'log' | 'switches';
  /** Pending counts, shown as badges. A queue you cannot see is a queue nobody works. */
  counts?: { verifications: number; faceChecks: number; reports: number; appeals: number };
  /** Who is signed in. */
  staffName: string;
  /**
   * The session token, carried by the sign-out form on EVERY page. A page with
   * no other form — an empty queue, an appeal that is not yours to decide —
   * would otherwise render no token at all.
   */
  csrf: string;
}

export const ADMIN_CSS = `
  :root {
    --bg: #11131a; --panel: #1a1d27; --line: #2a2f3d;
    --text: #e8eaf0; --muted: #8b93a7; --accent: #ff4d6d;
    --ok: #31c48d; --warn: #ffc53d; --danger: #ff3b30;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  header {
    display: flex; align-items: center; gap: 20px;
    padding: 12px 20px; background: var(--panel);
    border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 10;
  }
  header .brand { font-weight: 700; letter-spacing: .02em; }
  header nav { display: flex; gap: 4px; flex: 1; }
  header nav a {
    color: var(--muted); text-decoration: none; padding: 6px 12px; border-radius: 6px;
  }
  header nav a:hover { background: #222633; color: var(--text); }
  header nav a.on { background: var(--accent); color: #11131a; font-weight: 600; }
  header .who { color: var(--muted); font-size: 13px; }
  .badge {
    display: inline-block; min-width: 18px; padding: 0 5px; margin-left: 6px;
    background: var(--accent); color: #11131a; border-radius: 9px;
    font-size: 11px; font-weight: 700; text-align: center;
  }
  main { padding: 20px; max-width: 1200px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 20px; }
  .card {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px; padding: 16px; margin-bottom: 14px;
  }
  .row { display: flex; gap: 16px; align-items: flex-start; }
  .faces { display: flex; gap: 10px; }
  .faces figure { margin: 0; text-align: center; }
  .faces img {
    width: 150px; height: 150px; object-fit: cover;
    border-radius: 8px; background: #0b0d12; display: block;
  }
  .faces figcaption { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .meta { flex: 1; min-width: 0; }
  .meta dt { color: var(--muted); font-size: 12px; }
  .meta dd { margin: 0 0 8px; font-variant-numeric: tabular-nums; }
  .tag {
    display: inline-block; padding: 1px 8px; border-radius: 10px;
    font-size: 12px; font-weight: 600; border: 1px solid var(--line);
  }
  .tag.live { background: var(--ok); color: #11131a; border-color: var(--ok); }
  .tag.flag { background: var(--warn); color: #11131a; border-color: var(--warn); }
  .tag.susp { background: var(--danger); color: #fff; border-color: var(--danger); }
  form.actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  button, .btn {
    font: inherit; font-weight: 600; padding: 7px 14px; border-radius: 7px;
    border: 1px solid var(--line); background: #232838; color: var(--text); cursor: pointer;
  }
  button:hover { border-color: var(--muted); }
  button.ok { background: var(--ok); color: #11131a; border-color: var(--ok); }
  button.danger { background: var(--danger); color: #fff; border-color: var(--danger); }
  button.warn { background: var(--warn); color: #11131a; border-color: var(--warn); }
  input[type=text], input[type=password], input[type=email], textarea {
    font: inherit; padding: 8px 10px; border-radius: 7px;
    border: 1px solid var(--line); background: #0f1118; color: var(--text); width: 100%;
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-size: 12px; font-weight: 600; }
  td.num { font-variant-numeric: tabular-nums; }
  .empty { color: var(--muted); padding: 32px; text-align: center; }
  .flash { padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-weight: 600; }
  .flash.ok { background: rgba(49,196,141,.15); color: var(--ok); }
  .flash.err { background: rgba(255,59,48,.15); color: var(--danger); }
  .tag.on { background: var(--ok); color: #11131a; border-color: var(--ok); }
  .tag.off { background: var(--danger); color: #fff; border-color: var(--danger); }
  td.desc { color: var(--muted); font-size: 13px; max-width: 420px; }
  .quote {
    margin: 4px 0 0; padding: 6px 10px; border-left: 2px solid var(--line);
    color: var(--muted); font-size: 13px; max-width: 360px; white-space: pre-wrap;
  }
  .small { color: var(--muted); font-size: 12px; }
  form.stack { display: flex; flex-direction: column; gap: 6px; min-width: 220px; }
  form.stack .buttons { display: flex; gap: 6px; flex-wrap: wrap; }
  input.num { width: 110px; font-variant-numeric: tabular-nums; }
  input.short { width: 160px; }
  td.form-row form { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .tag.muted { color: var(--muted); }
  .tag.house { background: var(--warn); color: #11131a; border-color: var(--warn); }
  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  .toolbar input[type=text] { width: 260px; }
  .toolbar select { font: inherit; padding: 7px 10px; border-radius: 7px; border: 1px solid var(--line); background: #0f1118; color: var(--text); }
  select { font: inherit; padding: 7px 10px; border-radius: 7px; border: 1px solid var(--line); background: #0f1118; color: var(--text); }
  .kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
  .kv dt { color: var(--muted); font-size: 12px; }
  .kv dd { margin: 0; font-variant-numeric: tabular-nums; }
  h2 { font-size: 16px; margin: 24px 0 8px; }
  .check { display: inline-flex; align-items: center; gap: 6px; color: var(--text); }
  form.inline { display: flex; gap: 8px; align-items: center; }
  form.inline input[type=text] { width: 240px; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .fields label { display: block; color: var(--muted); font-size: 12px; margin-bottom: 4px; }
  .fields .wide { grid-column: 1 / -1; }
  code { font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; color: var(--text); }
  .login { max-width: 360px; margin: 80px auto; }
  .login .card > * + * { margin-top: 12px; }
  a { color: var(--accent); }
`;

const TABS: { key: Nav['active']; href: string; label: string }[] = [
  { key: 'queue', href: '/admin/queue', label: 'Review queue' },
  { key: 'reports', href: '/admin/reports', label: 'Reports' },
  { key: 'rooms', href: '/admin/rooms', label: 'Live rooms' },
  { key: 'users', href: '/admin/users', label: 'Users' },
  { key: 'agencies', href: '/admin/agencies', label: 'Agencies' },
  { key: 'catalog', href: '/admin/catalog', label: 'Catalog' },
  { key: 'log', href: '/admin/log', label: 'Enforcement log' },
  { key: 'switches', href: '/admin/switches', label: 'Switches' },
];

export function page(nav: Nav, title: string, body: Renderable): string {
  const pending =
    (nav.counts?.verifications ?? 0) + (nav.counts?.faceChecks ?? 0) + (nav.counts?.appeals ?? 0);

  return `<!doctype html>` + html`
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>${title} · Dhun admin</title>
  <link rel="stylesheet" href="/admin/style.css" />
</head>
<body>
  <header>
    <span class="brand">Dhun admin</span>
    <nav>
      ${TABS.map(
        (tab) => {
          const count =
            tab.key === 'queue' ? pending : tab.key === 'reports' ? (nav.counts?.reports ?? 0) : 0;
          return html`<a href="${tab.href}" class="${tab.key === nav.active ? 'on' : ''}"
            >${tab.label}${count > 0 ? html`<span class="badge">${count}</span>` : ''}</a
          >`;
        },
      )}
    </nav>
    <span class="who">${nav.staffName}</span>
    <form method="post" action="/admin/logout">
      <input type="hidden" name="csrf" value="${nav.csrf}" />
      <button>Sign out</button>
    </form>
  </header>
  <main>${body}</main>
</body>
</html>`.value;
}

/** The sign-in page, which has no nav because there is nobody to show it to. */
export function loginPage(error: string | null): string {
  return `<!doctype html>` + html`
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>Sign in · Dhun admin</title>
  <link rel="stylesheet" href="/admin/style.css" />
</head>
<body>
  <main class="login">
    <h1>Dhun admin</h1>
    <p class="sub">Staff only.</p>
    ${error ? html`<div class="flash err">${error}</div>` : ''}
    <form method="post" action="/admin/login" class="card">
      <div><label for="email">Email</label><input id="email" name="email" type="email" required autocomplete="username" /></div>
      <div><label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password" /></div>
      <button class="ok" type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`.value;
}

/** A banner after an action, carried in the redirect's query string. */
export function flash(message: string | undefined, kind: 'ok' | 'err' = 'ok'): SafeHtml | '' {
  if (!message) return '';
  return html`<div class="flash ${kind}">${message}</div>`;
}
