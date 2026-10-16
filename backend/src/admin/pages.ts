// The screens. Each one takes data and returns markup — no queries, no
// decisions. The router does the work; these say what it looks like.

import type { EnforcementEntry, PendingFaceCheck, PendingVerification } from '../modules/verification/index.js';
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
