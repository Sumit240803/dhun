// The Events screen: what is breaking, and what happened to this user.
//
// Two halves. The top groups the last day's warnings and errors by
// fingerprint, worst first, so one bug firing two hundred times is one row
// with a count. The bottom is the filtered list — by level, kind, process, a
// user id, a trace id, an event prefix or an error code — which is the half
// support uses when someone quotes a trace id from a screenshot.

import type { EventCounts, FingerprintGroup, SystemEvent } from '../modules/telemetry/index.js';
import { html, type SafeHtml } from './html.js';

export interface EventsFilterForm {
  level: string;
  kind: string;
  process: string;
  q: string;
  userId: string;
  traceId: string;
  fingerprint: string;
}

const KINDS = [
  'error',
  'security',
  'auth',
  'account',
  'money',
  'moderation',
  'config',
  'room',
  'job',
  'alert',
  'app',
];
const PROCESSES = ['api', 'gateway', 'workers', 'app'];

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  const ago =
    mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : mins < 1_440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1_440)}d ago`;
  // IST, because that is where the people reading this are.
  const ist = new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
  return `${ago} · ${ist} IST`;
}

function levelTag(level: string): SafeHtml {
  return html`<span class="tag level-${level}">${level}</span>`;
}

function option(value: string, selected: string, label = value): SafeHtml {
  return html`<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`;
}

function filterForm(f: EventsFilterForm): SafeHtml {
  return html`<form method="get" action="/admin/events" class="toolbar events-filter">
    <select name="level" aria-label="Level">
      ${option('', f.level, 'Any level')}
      ${['error', 'warn', 'info'].map((v) => option(v, f.level))}
    </select>
    <select name="kind" aria-label="Kind">
      ${option('', f.kind, 'Any kind')}
      ${KINDS.map((v) => option(v, f.kind))}
    </select>
    <select name="process" aria-label="Process">
      ${option('', f.process, 'Any process')}
      ${PROCESSES.map((v) => option(v, f.process))}
    </select>
    <input name="q" value="${f.q}" placeholder="event prefix or error code" maxlength="64" />
    <input name="userId" value="${f.userId}" placeholder="user id" maxlength="36" />
    <input name="traceId" value="${f.traceId}" placeholder="trace id" maxlength="64" />
    ${f.fingerprint ? html`<input type="hidden" name="fingerprint" value="${f.fingerprint}" />` : ''}
    <button>Filter</button>
    <a href="/admin/events">Clear</a>
  </form>`;
}

function countsStrip(counts: EventCounts): SafeHtml {
  return html`<div class="row counts">
    <a class="kv" href="/admin/events?level=error"><strong>${counts.errors}</strong> errors · 24h</a>
    <a class="kv" href="/admin/events?level=warn"><strong>${counts.warns}</strong> warnings · 24h</a>
    <a class="kv" href="/admin/events?level=info"><strong>${counts.infos}</strong> audit rows · 24h</a>
  </div>`;
}

function groupsTable(groups: FingerprintGroup[]): SafeHtml {
  if (groups.length === 0) {
    return html`<div class="card empty">No warnings or errors in the last 24 hours.</div>`;
  }
  return html`<div class="card"><table>
    <thead><tr><th>Level</th><th>Event</th><th>Code</th><th>Last message</th><th>Count</th><th>Users</th><th>Last seen</th></tr></thead>
    <tbody>
      ${groups.map(
        (g) => html`<tr>
          <td>${levelTag(g.level)}</td>
          <td><a href="/admin/events?fingerprint=${g.fingerprint}"><strong>${g.event}</strong></a><div class="small">${g.process}</div></td>
          <td>${g.code ?? ''}</td>
          <td class="small">${g.message ?? ''}</td>
          <td><strong>${g.count}</strong></td>
          <td>${g.users}</td>
          <td class="small">${when(g.lastAt)}</td>
        </tr>`,
      )}
    </tbody>
  </table></div>`;
}

function metaBlock(meta: Record<string, unknown>): SafeHtml | '' {
  const keys = Object.keys(meta);
  if (keys.length === 0) return '';
  // Pretty JSON inside <pre>; `html` escapes it, so a message containing a
  // <script> tag is text on the page, never markup.
  return html`<details><summary class="small">meta · ${keys.length} ${keys.length === 1 ? 'key' : 'keys'}</summary><pre class="meta-json">${JSON.stringify(meta, null, 2)}</pre></details>`;
}

function eventsTable(events: SystemEvent[]): SafeHtml {
  if (events.length === 0) return html`<div class="card empty">Nothing matches.</div>`;
  return html`<div class="card"><table class="events">
    <thead><tr><th>When</th><th>Level</th><th>Event</th><th>Message</th><th>Who / where</th></tr></thead>
    <tbody>
      ${events.map(
        (e) => html`<tr>
          <td class="small">${when(e.occurredAt)}</td>
          <td>${levelTag(e.level)}<div class="small">${e.kind} · ${e.process}</div></td>
          <td>
            <a href="/admin/events?fingerprint=${e.fingerprint}"><strong>${e.event}</strong></a>
            ${e.code ? html`<div class="small">${e.code}</div>` : ''}
          </td>
          <td>
            ${e.message ?? ''}
            ${metaBlock(e.meta)}
          </td>
          <td class="small">
            ${e.userId ? html`<a href="/admin/users/${e.userId}">user</a> · ` : ''}
            ${e.path ?? ''}
            ${e.traceId ? html`<div><a href="/admin/events?traceId=${e.traceId}">trace ${e.traceId.slice(0, 8)}…</a></div>` : ''}
          </td>
        </tr>`,
      )}
    </tbody>
  </table></div>`;
}

export function eventsPage(data: {
  counts: EventCounts;
  groups: FingerprintGroup[];
  events: SystemEvent[];
  filter: EventsFilterForm;
  filtered: boolean;
}): SafeHtml {
  return html`
    <h1>Events</h1>
    <p class="sub">
      Every error from the API, gateway and workers, what the app reports about itself, security
      signals, and the audit trail of who did what. Append-only; rows leave only by age.
    </p>
    ${countsStrip(data.counts)}
    ${data.filtered
      ? ''
      : html`<h2>Breaking now <span class="small">warnings and errors, last 24 hours, grouped</span></h2>
          ${groupsTable(data.groups)}`}
    <h2>${data.filtered ? 'Matching events' : 'Latest'}</h2>
    ${filterForm(data.filter)}
    ${eventsTable(data.events)}
  `;
}
