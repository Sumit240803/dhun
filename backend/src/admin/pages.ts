// The screens. Each one takes data and returns markup — no queries, no
// decisions. The router does the work; these say what it looks like.

import type { AppVersions, ConfigChange, FeatureKey } from '../modules/config/index.js';
import type { OpenReport } from '../modules/moderation/index.js';
import { FEATURE_KEYS, FEATURES } from '../modules/config/index.js';
import type {
  EnforcementEntry,
  OpenAppeal,
  PendingFaceCheck,
  PendingVerification,
} from '../modules/verification/index.js';
import { html, safeUrl, type SafeHtml } from './html.js';

/** A hidden CSRF input. Every form on every page carries one. */
function csrfField(csrf: string): SafeHtml {
  return html`<input type="hidden" name="csrf" value="${csrf}" />`;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const REASONS: Record<string, string> = {
  new_device: 'New device',
  stale: 'Not reviewed in 24h',
  flagged: 'Account is flagged',
  sample: 'Random check',
};

// ---------------------------------------------------------------------------
// The review queue — the screen this whole panel was built for
// ---------------------------------------------------------------------------

export function queuePage(data: {
  verifications: PendingVerification[];
  checks: PendingFaceCheck[];
  appeals: OpenAppeal[];
  /** Whether this staff member may decide appeals — a lead's call. */
  canDecideAppeals: boolean;
  /** Who is signed in, so the form can say "not yours to decide" on their own suspensions. */
  staffId: string;
  csrf: string;
}): SafeHtml {
  return html`
    <h1>Review queue</h1>
    <p class="sub">
      Onboarding photos are decided oldest first. Go-live frames are newest first — a
      stream still running is the only one where ending the room is an option.
    </p>

    <h2>Onboarding photos <span class="badge">${data.verifications.length}</span></h2>
    ${data.verifications.length === 0
      ? html`<div class="card empty">Nothing waiting. Nobody is blocked from being verified.</div>`
      : data.verifications.map(
          (item) => html`
            <div class="card">
              <div class="row">
                <div class="faces">
                  <figure>
                    <img src="${safeUrl(item.faceUrl)}" alt="" />
                    <figcaption>Submitted photo</figcaption>
                  </figure>
                </div>
                <div class="meta">
                  <dl>
                    <dt>Host</dt>
                    <dd>${item.displayName ?? '—'} · ID ${item.publicId}</dd>
                    <dt>Waiting</dt>
                    <dd>${item.waitingHours}h</dd>
                  </dl>
                  <form class="actions" method="post" action="/admin/queue/verification">
                    ${csrfField(data.csrf)}
                    <input type="hidden" name="userId" value="${item.userId}" />
                    <input type="text" name="note" placeholder="Note to the host (shown on a rejection)" />
                    <button class="ok" name="decision" value="approve">Approve</button>
                    <button class="danger" name="decision" value="reject">Reject</button>
                  </form>
                </div>
              </div>
            </div>
          `,
        )}

    <h2 style="margin-top:28px">Go-live frames <span class="badge">${data.checks.length}</span></h2>
    ${data.checks.length === 0
      ? html`<div class="card empty">Nothing waiting.</div>`
      : data.checks.map((check) => faceCheckCard(check, data.csrf))}

    <h2 style="margin-top:28px">Appeals <span class="badge">${data.appeals.length}</span></h2>
    <p class="sub">
      A suspended host asking for a second look. Decided by someone OTHER than the person
      who suspended them — the form knows who you are. Your note is shown to the host.
    </p>
    ${data.appeals.length === 0
      ? html`<div class="card empty">No open appeals.</div>`
      : data.appeals.map((appeal) => appealCard(appeal, data))}
  `;
}

function appealCard(
  appeal: OpenAppeal,
  data: { canDecideAppeals: boolean; staffId: string; csrf: string },
): SafeHtml {
  const mine = appeal.suspension.actorId === data.staffId;
  return html`
    <div class="card">
      <div class="row">
        <div class="meta">
          <dl>
            <dt>Host</dt>
            <dd>
              <a href="/admin/users/${appeal.userId}">${appeal.displayName ?? '—'}</a>
              · ID ${appeal.publicId} · appealed ${timeAgo(appeal.at)}
            </dd>
            <dt>Suspended</dt>
            <dd>
              ${timeAgo(appeal.suspension.at)} by ${appeal.suspension.actorName ?? '—'}
              (${appeal.suspension.source.replace('_', ' ')})
              ${appeal.suspension.note ? html`<p class="quote">${appeal.suspension.note}</p>` : ''}
            </dd>
            <dt>What the host says</dt>
            <dd><p class="quote">${appeal.message}</p></dd>
          </dl>

          ${mine
            ? html`<p class="small">You suspended this host, so this one is for someone else to decide.</p>`
            : !data.canDecideAppeals
              ? html`<p class="small">Only a lead can decide an appeal.</p>`
              : html`<form class="actions" method="post" action="/admin/queue/appeal">
                  ${csrfField(data.csrf)}
                  <input type="hidden" name="appealId" value="${appeal.id}" />
                  <input type="text" name="note" placeholder="Note to the host (shown to them)" maxlength="500" />
                  <button class="ok" name="decision" value="overturned">Lift suspension</button>
                  <button class="danger" name="decision" value="upheld">Uphold</button>
                </form>`}
        </div>
      </div>
    </div>
  `;
}

function faceCheckCard(check: PendingFaceCheck, csrf: string): SafeHtml {
  return html`
    <div class="card">
      <div class="row">
        <div class="faces">
          <figure>
            <img src="${safeUrl(check.faceUrl)}" alt="" />
            <figcaption>Going live, ${timeAgo(check.at)}</figcaption>
          </figure>
          <figure>
            <img src="${safeUrl(check.referenceUrl)}" alt="" />
            <figcaption>
              ${check.referenceUrl === null ? 'No approved photo' : 'Verified photo'}
            </figcaption>
          </figure>
        </div>

        <div class="meta">
          <dl>
            <dt>Host</dt>
            <dd>
              <a href="/admin/users/${check.userId}">${check.displayName ?? '—'}</a>
              · ID ${check.publicId}
              ${check.flagged ? html`<span class="tag flag">flagged</span>` : ''}
              ${check.suspended ? html`<span class="tag susp">suspended</span>` : ''}
            </dd>
            <dt>Room</dt>
            <dd>
              ${check.roomTitle} · ${check.roomPublicId}
              ${check.live ? html`<span class="tag live">live now</span>` : ''}
            </dd>
            <dt>Queued because</dt>
            <dd>${REASONS[check.reason] ?? check.reason}</dd>
            <dt>Device</dt>
            <dd>${check.deviceId ?? 'unknown'}</dd>
          </dl>

          <form class="actions" method="post" action="/admin/queue/check">
            ${csrfField(csrf)}
            <input type="hidden" name="checkId" value="${check.id}" />
            <button class="ok" name="decision" value="ok">Same person</button>
            <button name="decision" value="unclear">Can't tell</button>
            <button class="warn" name="decision" value="flag">Flag &amp; watch</button>
            ${check.live
              ? html`<button class="warn" name="decision" value="end_room">End this room</button>`
              : ''}
            <button class="danger" name="decision" value="suspend">Suspend host</button>
          </form>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Live rooms
// ---------------------------------------------------------------------------

export interface LiveRoomRow {
  id: string;
  publicId: number;
  title: string;
  hostId: string;
  hostName: string | null;
  viewers: number;
  startedAt: string;
  flagged: boolean;
}

export function roomsPage(rooms: LiveRoomRow[], csrf: string): SafeHtml {
  return html`
    <h1>Live rooms</h1>
    <p class="sub">${rooms.length} broadcasting now.</p>

    ${rooms.length === 0
      ? html`<div class="card empty">Nobody is live.</div>`
      : html`<div class="card"><table>
          <thead>
            <tr><th>Room</th><th>Host</th><th>Viewers</th><th>Started</th><th></th></tr>
          </thead>
          <tbody>
            ${rooms.map(
              (room) => html`<tr>
                <td>${room.title} <span class="who">${room.publicId}</span></td>
                <td>
                  <a href="/admin/users/${room.hostId}">${room.hostName ?? '—'}</a>
                  ${room.flagged ? html`<span class="tag flag">flagged</span>` : ''}
                </td>
                <td class="num">${room.viewers}</td>
                <td>${timeAgo(room.startedAt)}</td>
                <td>
                  <form method="post" action="/admin/rooms/end">
                    ${csrfField(csrf)}
                    <input type="hidden" name="roomId" value="${room.id}" />
                    <button class="danger">End room</button>
                  </form>
                </td>
              </tr>`,
            )}
          </tbody>
        </table></div>`}
  `;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserRow {
  id: string;
  publicId: number;
  displayName: string | null;
  phone: string | null;
  verification: string;
  flagged: boolean;
  suspended: boolean;
  createdAt: string;
}

export function usersPage(query: string, results: UserRow[]): SafeHtml {
  return html`
    <h1>Users</h1>
    <p class="sub">Search by public ID or name.</p>

    <div class="card">
      <form method="get" action="/admin/users">
        <input type="text" name="q" value="${query}" placeholder="12345678 or a name" autofocus />
      </form>
    </div>

    ${query === ''
      ? html`<div class="card empty">Type an ID or a name to begin.</div>`
      : results.length === 0
        ? html`<div class="card empty">Nothing matched “${query}”.</div>`
        : html`<div class="card"><table>
            <thead><tr><th>Name</th><th>ID</th><th>Verification</th><th>State</th><th>Joined</th></tr></thead>
            <tbody>
              ${results.map(
                (user) => html`<tr>
                  <td><a href="/admin/users/${user.id}">${user.displayName ?? '—'}</a></td>
                  <td class="num">${user.publicId}</td>
                  <td>${user.verification}</td>
                  <td>
                    ${user.flagged ? html`<span class="tag flag">flagged</span>` : ''}
                    ${user.suspended ? html`<span class="tag susp">suspended</span>` : ''}
                  </td>
                  <td>${timeAgo(user.createdAt)}</td>
                </tr>`,
              )}
            </tbody>
          </table></div>`}
  `;
}

export function userPage(data: {
  user: UserRow;
  history: EnforcementEntry[];
  recentChecks: { at: string; status: string; reason: string }[];
  csrf: string;
}): SafeHtml {
  const { user } = data;
  return html`
    <h1>${user.displayName ?? '—'}</h1>
    <p class="sub">
      ID ${user.publicId} · joined ${timeAgo(user.createdAt)} · verification: ${user.verification}
      ${user.flagged ? html`<span class="tag flag">flagged</span>` : ''}
      ${user.suspended ? html`<span class="tag susp">suspended</span>` : ''}
    </p>

    <div class="card">
      <form class="actions" method="post" action="/admin/users/action">
        ${csrfField(data.csrf)}
        <input type="hidden" name="userId" value="${user.id}" />
        <input type="text" name="note" placeholder="Why (recorded in the log)" />
        ${user.flagged
          ? html`<button name="action" value="clear_flag">Clear flag</button>`
          : html`<button class="warn" name="action" value="flag">Flag</button>`}
        ${user.suspended
          ? html`<button class="ok" name="action" value="unsuspend">Lift suspension</button>`
          : html`<button class="danger" name="action" value="suspend">Suspend</button>`}
      </form>
    </div>

    <h2>Recent face checks</h2>
    ${data.recentChecks.length === 0
      ? html`<div class="card empty">None recorded.</div>`
      : html`<div class="card"><table>
          <thead><tr><th>When</th><th>Queued because</th><th>Outcome</th></tr></thead>
          <tbody>
            ${data.recentChecks.map(
              (check) => html`<tr>
                <td>${timeAgo(check.at)}</td>
                <td>${REASONS[check.reason] ?? check.reason}</td>
                <td>${check.status}</td>
              </tr>`,
            )}
          </tbody>
        </table></div>`}

    <h2>Enforcement history</h2>
    ${logTable(data.history)}
  `;
}

// ---------------------------------------------------------------------------
// Enforcement log
// ---------------------------------------------------------------------------

export function logPage(entries: EnforcementEntry[]): SafeHtml {
  return html`
    <h1>Enforcement log</h1>
    <p class="sub">
      Append-only. Nothing here can be edited or deleted — an appeal depends on a second
      reviewer seeing exactly what the first one did.
    </p>
    ${logTable(entries)}
  `;
}

function logTable(entries: EnforcementEntry[]): SafeHtml {
  if (entries.length === 0) return html`<div class="card empty">Nothing recorded.</div>`;

  return html`<div class="card"><table>
    <thead><tr><th>When</th><th>Action</th><th>Subject</th><th>By</th><th>Source</th><th>Note</th></tr></thead>
    <tbody>
      ${entries.map(
        (entry) => html`<tr>
          <td>${timeAgo(entry.at)}</td>
          <td><strong>${entry.action.replace('_', ' ')}</strong></td>
          <td>
            ${entry.subjectType === 'user'
              ? html`<a href="/admin/users/${entry.subjectId}">user</a>`
              : 'room'}
          </td>
          <td>${entry.actorName ?? '—'}</td>
          <td>${entry.source.replace('_', ' ')}</td>
          <td>${entry.note ?? ''}</td>
        </tr>`,
      )}
    </tbody>
  </table></div>`;
}

// ---------------------------------------------------------------------------
// Switches — kill switch first, fix second
// ---------------------------------------------------------------------------

export function switchesPage(data: {
  states: Record<FeatureKey, boolean>;
  versions: AppVersions;
  changes: ConfigChange[];
  csrf: string;
}): SafeHtml {
  return html`
    <h1>Switches</h1>
    <p class="sub">
      Kill switch first, fix second. Switching a feature off refuses it on the server,
      deactivates its ledger transaction types and hides it in the app — in one write.
      Every change here is recorded with your name and the reason you give.
    </p>

    <h2>Features</h2>
    <div class="card"><table>
      <thead><tr><th>Feature</th><th>State</th><th>What off does</th><th></th></tr></thead>
      <tbody>
        ${FEATURE_KEYS.map((key) => {
          const spec = FEATURES[key];
          const on = data.states[key];
          return html`<tr>
            <td><strong>${spec.label}</strong><br /><code>${key}</code></td>
            <td>${on ? html`<span class="tag on">on</span>` : html`<span class="tag off">off</span>`}</td>
            <td class="desc">${spec.description}</td>
            <td>
              <form class="inline" method="post" action="/admin/switches/feature">
                ${csrfField(data.csrf)}
                <input type="hidden" name="feature" value="${key}" />
                <input type="hidden" name="state" value="${on ? 'off' : 'on'}" />
                <input type="text" name="reason" placeholder="Why (recorded)" required minlength="3" maxlength="500" />
                ${on
                  ? html`<button class="danger">Switch off</button>`
                  : html`<button class="ok">Switch on</button>`}
              </form>
            </td>
          </tr>`;
        })}
      </tbody>
    </table></div>

    <h2>App versions</h2>
    <div class="card">
      <form method="post" action="/admin/switches/versions">
        ${csrfField(data.csrf)}
        <div class="fields">
          <div>
            <label for="minSupported">Minimum supported</label>
            <input id="minSupported" type="text" name="minSupported" value="${data.versions.minSupported}" required />
          </div>
          <div>
            <label for="latest">Latest published</label>
            <input id="latest" type="text" name="latest" value="${data.versions.latest}" required />
          </div>
          <div class="wide">
            <label for="storeUrl">Store link</label>
            <input id="storeUrl" type="text" name="storeUrl" value="${data.versions.storeUrl}" />
          </div>
          <div class="wide">
            <label for="vreason">Why (recorded)</label>
            <input id="vreason" type="text" name="reason" required minlength="3" maxlength="500" />
          </div>
        </div>
        <div class="actions" style="margin-top:12px">
          <button class="warn">Save versions</button>
        </div>
      </form>
      <p class="sub" style="margin:12px 0 0">
        Below <strong>minimum supported</strong> the app blocks with an update prompt the user
        cannot dismiss. Move it only for a security fix or a broken money path. Below
        <strong>latest</strong> the app offers an update the user can decline — that is the one
        to move for an ordinary release.
      </p>
    </div>

    <h2>Recent changes</h2>
    ${data.changes.length === 0
      ? html`<div class="card empty">Nothing has been switched yet.</div>`
      : html`<div class="card"><table>
          <thead><tr><th>When</th><th>Setting</th><th>From</th><th>To</th><th>By</th><th>Why</th></tr></thead>
          <tbody>
            ${data.changes.map(
              (change) => html`<tr>
                <td>${timeAgo(change.at)}</td>
                <td><code>${change.key}</code></td>
                <td>${showValue(change.oldValue)}</td>
                <td><strong>${showValue(change.newValue)}</strong></td>
                <td>${change.actorName ?? '—'}</td>
                <td>${change.reason}</td>
              </tr>`,
            )}
          </tbody>
        </table></div>`}
  `;
}

/** A stored value, as a person reads it: booleans as on/off, strings as themselves. */
function showValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Reports — what users flagged, waiting for a decision
// ---------------------------------------------------------------------------

/** The app's reasons, as the moderator reads them. */
const REPORT_REASONS: Record<string, string> = {
  nudity: 'Nudity or sexual content',
  harassment: 'Harassment or bullying',
  hate: 'Hate speech',
  violence: 'Violence or threats',
  self_harm: 'Self-harm',
  minor: 'Possibly under 18',
  scam: 'Scam or fraud',
  spam: 'Spam',
  impersonation: 'Impersonation',
  illegal: 'Something illegal',
  other: 'Other',
};

export function reportsPage(data: { reports: OpenReport[]; csrf: string; canSuspend: boolean }): SafeHtml {
  return html`
    <h1>Reports</h1>
    <p class="sub">
      Open reports, live rooms first. A decision about the person — flag, suspend — closes
      every open report about them; dismissing closes only the one you dismissed.
      Reporters are never told who acted or what was decided.
    </p>

    ${data.reports.length === 0
      ? html`<div class="card empty">Nothing open. Every report has been looked at.</div>`
      : html`<div class="card"><table>
          <thead>
            <tr><th>When</th><th>Reason</th><th>About</th><th>Reported by</th><th></th></tr>
          </thead>
          <tbody>
            ${data.reports.map((report) => reportRow(report, data.csrf, data.canSuspend))}
          </tbody>
        </table></div>`}
  `;
}

function reportRow(report: OpenReport, csrf: string, canSuspend: boolean): SafeHtml {
  const subject = report.subject;
  const live = report.room?.live === true;

  return html`<tr>
    <td>${timeAgo(report.at)}</td>
    <td>
      <strong>${REPORT_REASONS[report.reason] ?? report.reason}</strong>
      ${report.reason === 'minor' ? html` <span class="tag susp">18+</span>` : ''}
      ${report.detail ? html`<p class="quote">${report.detail}</p>` : ''}
    </td>
    <td>
      ${subject === null
        ? html`<span class="small">Content no longer exists</span>`
        : html`<a href="/admin/users/${subject.userId}">${subject.name ?? '—'}</a>
            <span class="small">· ID ${subject.publicId}</span>
            ${subject.flagged ? html`<span class="tag flag">flagged</span>` : ''}
            ${subject.suspended ? html`<span class="tag susp">suspended</span>` : ''}
            ${subject.openReports > 1
              ? html`<div class="small">${subject.openReports} open reports about this person</div>`
              : ''}`}
      ${report.room
        ? html`<div class="small">
            Room: ${report.room.title} · ${report.room.publicId}
            ${live ? html`<span class="tag live">live now</span>` : html`<span class="small">(ended)</span>`}
          </div>`
        : ''}
      ${report.message ? html`<p class="quote">${report.message.body}</p>` : ''}
    </td>
    <td>
      <a href="/admin/users/${report.reporter.id}">${report.reporter.name ?? '—'}</a>
      <span class="small">· ${report.reporter.publicId}</span>
    </td>
    <td>
      <form class="stack" method="post" action="/admin/reports/decide">
        ${csrfField(csrf)}
        <input type="hidden" name="reportId" value="${report.id}" />
        <input type="text" name="note" placeholder="Note (recorded in the log)" />
        <div class="buttons">
          <button name="decision" value="dismiss">Dismiss</button>
          ${subject === null
            ? ''
            : html`<button class="warn" name="decision" value="flag">Flag &amp; watch</button>
                ${live ? html`<button class="warn" name="decision" value="end_room">End room</button>` : ''}
                ${canSuspend
                  ? html`<button class="danger" name="decision" value="suspend">Suspend</button>`
                  : ''}`}
        </div>
      </form>
    </td>
  </tr>`;
}
