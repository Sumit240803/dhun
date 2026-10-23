// The agency back office — what was API-only since M12, as pages.
//
// Two screens: the list (with the create form, the prepay form and the
// pending prepays that need a second person) and one agency in full.
// Everything here is money-adjacent, so each form says what it will do in the
// words the ledger uses: a prepay is RECORDED by one person and CONFIRMED by
// another, and only the confirmation mints coins.

import type { AgencyDetail, AgencySummary, Prepay, TransferAudit } from '../modules/agency/index.js';
import { html, type SafeHtml } from './html.js';

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

/** Indian grouping, as the app shows it: 1,64,945. */
export function num(value: number): string {
  return value.toLocaleString('en-IN');
}

export function rupees(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function statusTag(status: AgencySummary['status']): SafeHtml {
  if (status === 'active') return html`<span class="tag live">active</span>`;
  if (status === 'suspended') return html`<span class="tag susp">suspended</span>`;
  return html`<span class="tag muted">closed</span>`;
}

const METHODS: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  gateway: 'Gateway',
};

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function agenciesPage(data: {
  agencies: AgencySummary[];
  pending: Prepay[];
  transfers: TransferAudit[] | null;
  query: string;
  status: string;
  userQuery: string;
  csrf: string;
  staffId: string;
  minPrepayRupees: number;
}): SafeHtml {
  return html`
    <h1>Agencies</h1>
    <p class="sub">
      The reseller network. An agency buys coin inventory from us (a <strong>prepay</strong>) and
      sells it on to users off-platform; we never see that payment. Nobody's earnings pass
      through an agency — hard rule #2.
    </p>

    <h2>Pending prepays <span class="badge">${data.pending.length}</span></h2>
    <p class="sub">
      Money an agency says it sent. Confirming mints the coins into its inventory and is the
      only step that moves anything — so it must be a different person from the one who
      recorded it. The database refuses the same person doing both.
    </p>
    ${data.pending.length === 0
      ? html`<div class="card empty">Nothing waiting to be confirmed.</div>`
      : html`<div class="card"><table>
          <thead>
            <tr><th>Recorded</th><th>Agency</th><th>Amount</th><th>Rate</th><th>Coins</th><th>How</th><th>Reference</th><th></th></tr>
          </thead>
          <tbody>
            ${data.pending.map(
              (p) => html`<tr>
                <td>${timeAgo(p.recordedAt)}</td>
                <td><a href="/admin/agencies/${p.agency.id}">${p.agency.name}</a> <span class="small">· ${p.agency.publicId}</span></td>
                <td class="num">${rupees(p.amountPaise)}</td>
                <td class="num">${p.coinsPerRupee}/₹</td>
                <td class="num">${num(p.coins)}</td>
                <td>${METHODS[p.method] ?? p.method}</td>
                <td><code>${p.paymentReference}</code></td>
                <td class="form-row">
                  <form method="post" action="/admin/agencies/prepay/${p.id}/confirm">
                    ${csrfField(data.csrf)}
                    <button class="ok">Confirm &amp; mint</button>
                  </form>
                  <form method="post" action="/admin/agencies/prepay/${p.id}/reject">
                    ${csrfField(data.csrf)}
                    <input type="text" name="reason" class="short" placeholder="Why (recorded)" required />
                    <button class="danger">Reject</button>
                  </form>
                </td>
              </tr>`,
            )}
          </tbody>
        </table></div>`}

    <h2>Record a prepay</h2>
    <div class="card">
      <form method="post" action="/admin/agencies/prepay" class="fields">
        ${csrfField(data.csrf)}
        <div>
          <label for="pAgency">Agency ID</label>
          <input id="pAgency" type="text" name="agencyId" class="num" inputmode="numeric" required />
        </div>
        <div>
          <label for="pAmount">Amount received (₹)</label>
          <input id="pAmount" type="text" name="rupees" class="num" inputmode="numeric" required />
        </div>
        <div>
          <label for="pMethod">How it arrived</label>
          <select id="pMethod" name="method">
            <option value="bank_transfer">Bank transfer</option>
            <option value="upi">UPI</option>
            <option value="gateway">Gateway</option>
          </select>
        </div>
        <div>
          <label for="pRef">Payment reference (UTR / UPI ref)</label>
          <input id="pRef" type="text" name="paymentReference" required minlength="4" maxlength="64" />
        </div>
        <div class="wide actions"><button class="warn">Record (does not mint)</button></div>
      </form>
      <p class="sub" style="margin:12px 0 0">
        Minimum ${rupees(data.minPrepayRupees * 100)}. The wholesale rate is set by the amount
        (config: <code>agency.wholesaleTiers</code>). Someone else confirms it above.
      </p>
    </div>

    <h2>All agencies</h2>
    <form method="get" action="/admin/agencies" class="toolbar">
      <input type="text" name="q" value="${data.query}" placeholder="Name, agency ID or owner ID" />
      <select name="status">
        <option value="" ${data.status === '' ? 'selected' : ''}>Any status</option>
        <option value="active" ${data.status === 'active' ? 'selected' : ''}>Active</option>
        <option value="suspended" ${data.status === 'suspended' ? 'selected' : ''}>Suspended</option>
        <option value="closed" ${data.status === 'closed' ? 'selected' : ''}>Closed</option>
      </select>
      <button>Search</button>
    </form>
    ${data.agencies.length === 0
      ? html`<div class="card empty">No agencies match.</div>`
      : html`<div class="card"><table>
          <thead>
            <tr><th>Agency</th><th>Owner</th><th>Status</th><th>Coins</th><th>Agents</th><th>Hosts</th><th>Inventory</th><th>Created</th></tr>
          </thead>
          <tbody>
            ${data.agencies.map(
              (a) => html`<tr>
                <td>
                  <a href="/admin/agencies/${a.id}"><strong>${a.name}</strong></a>
                  <span class="small">· ${a.publicId}</span>
                  ${a.isHouse ? html`<span class="tag house">in-house</span>` : ''}
                </td>
                <td><a href="/admin/users/${a.owner.userId}">${a.owner.displayName ?? '—'}</a> <span class="small">· ${a.owner.publicId}</span></td>
                <td>${statusTag(a.status)}</td>
                <td>${a.coinTradingEnabled ? html`<span class="tag live">trading</span>` : html`<span class="tag muted">no</span>`}</td>
                <td class="num">${a.agentCount}</td>
                <td class="num">${a.hostCount}</td>
                <td class="num">${num(a.inventoryCoins)}</td>
                <td>${timeAgo(a.createdAt)}</td>
              </tr>`,
            )}
          </tbody>
        </table></div>`}

    <h2>Create an agency</h2>
    <div class="card">
      <form method="post" action="/admin/agencies/create" class="fields">
        ${csrfField(data.csrf)}
        <div>
          <label for="cOwner">Owner's User ID</label>
          <input id="cOwner" type="text" name="ownerUserId" class="num" inputmode="numeric" required />
        </div>
        <div>
          <label for="cName">Agency name</label>
          <input id="cName" type="text" name="name" required minlength="2" maxlength="60" />
        </div>
        <div>
          <label for="cEmail">Contact email (optional)</label>
          <input id="cEmail" type="email" name="contactEmail" maxlength="254" />
        </div>
        <div>
          <label class="check"><input type="checkbox" name="isHouse" /> The in-house agency (platform-seeded hosts, earns no commission)</label>
        </div>
        <div class="wide actions"><button class="ok">Create</button></div>
      </form>
      <p class="sub" style="margin:12px 0 0">
        The owner gets the agent seat with agent management. Coin trading is a separate grant
        on the agency's page — buying inventory is where fraud lands, and an agency that only
        manages hosts should not automatically move currency.
      </p>
    </div>

    <h2>Transfer audit</h2>
    <p class="sub">
      "I paid the agency and never got my coins." We never saw that payment; what we can show
      is what the agency sent, and when. Search by the user's ID.
    </p>
    <form method="get" action="/admin/agencies" class="toolbar">
      <input type="text" name="userId" value="${data.userQuery}" class="num" inputmode="numeric" placeholder="User ID" />
      <button>Find transfers</button>
    </form>
    ${data.transfers === null
      ? ''
      : data.transfers.length === 0
        ? html`<div class="card empty">No transfers to that user.</div>`
        : transfersTable(data.transfers)}
  `;
}

export function transfersTable(transfers: TransferAudit[]): SafeHtml {
  return html`<div class="card"><table>
    <thead><tr><th>When</th><th>Agency</th><th>Sent by</th><th>To</th><th>Coins</th><th>Note</th></tr></thead>
    <tbody>
      ${transfers.map(
        (t) => html`<tr>
          <td>${timeAgo(t.createdAt)}</td>
          <td><a href="/admin/agencies/${t.agency.id}">${t.agency.name}</a> <span class="small">· ${t.agency.publicId}</span></td>
          <td><a href="/admin/users/${t.sentBy.userId}">${t.sentBy.publicId}</a></td>
          <td><a href="/admin/users/${t.recipient.userId}">${t.recipient.displayName ?? '—'}</a> <span class="small">· ${t.recipient.publicId}</span></td>
          <td class="num">${num(t.coins)}</td>
          <td>${t.note ?? ''}</td>
        </tr>`,
      )}
    </tbody>
  </table></div>`;
}

// ---------------------------------------------------------------------------
// One agency
// ---------------------------------------------------------------------------

export function agencyPage(data: {
  agency: AgencyDetail;
  prepays: Prepay[];
  transfers: TransferAudit[];
  csrf: string;
}): SafeHtml {
  const a = data.agency;
  return html`
    <h1>${a.name} <span class="who">· ${a.publicId}</span></h1>
    <p class="sub">
      ${statusTag(a.status)}
      ${a.coinTradingEnabled ? html`<span class="tag live">coin trading</span>` : html`<span class="tag muted">no coin trading</span>`}
      ${a.isHouse ? html`<span class="tag house">in-house</span>` : ''}
      · owner <a href="/admin/users/${a.owner.userId}">${a.owner.displayName ?? '—'}</a> (${a.owner.publicId})
      · created ${timeAgo(a.createdAt)}
      ${a.contactEmail ? html`· ${a.contactEmail}` : ''}
    </p>
    ${a.suspendedReason ? html`<div class="flash err">Suspended: ${a.suspendedReason}</div>` : ''}

    <div class="row">
      <div class="card" style="flex:1">
        <dl class="kv">
          <dt>Agents</dt><dd>${a.agentCount}</dd>
          <dt>Hosts</dt><dd>${a.hostCount}</dd>
          <dt>Inventory</dt><dd>${num(a.inventoryCoins)} coins</dd>
          <dt>Prepaid</dt><dd>${rupees(a.prepaid.confirmedPaise)} → ${num(a.prepaid.confirmedCoins)} coins${a.prepaid.pendingCount > 0 ? html` · ${a.prepaid.pendingCount} pending` : ''}</dd>
          <dt>Transferred</dt><dd>${num(a.transferred.coins)} coins in ${a.transferred.count} transfers</dd>
        </dl>
      </div>

      <div class="card" style="flex:1">
        <form method="post" action="/admin/agencies/${a.id}/coin-trading" class="actions" style="margin:0 0 12px">
          ${csrfField(data.csrf)}
          <input type="hidden" name="enabled" value="${a.coinTradingEnabled ? 'off' : 'on'}" />
          ${a.coinTradingEnabled
            ? html`<button class="danger">Withdraw coin trading</button>`
            : html`<button class="ok">Grant coin trading</button>`}
        </form>
        ${a.status === 'closed'
          ? html`<p class="small">Closed agencies cannot be reopened.</p>`
          : html`<form method="post" action="/admin/agencies/${a.id}/status" class="actions" style="margin:0">
              ${csrfField(data.csrf)}
              <input type="text" name="reason" placeholder="Why (recorded)" required minlength="1" maxlength="500" />
              ${a.status === 'active'
                ? html`<button class="warn" name="status" value="suspended">Suspend</button>`
                : html`<button class="ok" name="status" value="active">Reinstate</button>`}
              <button class="danger" name="status" value="closed">Close for good</button>
            </form>`}
      </div>
    </div>

    <h2>Prepays</h2>
    ${data.prepays.length === 0
      ? html`<div class="card empty">None recorded.</div>`
      : html`<div class="card"><table>
          <thead><tr><th>Recorded</th><th>Amount</th><th>Rate</th><th>Coins</th><th>How</th><th>Reference</th><th>Status</th></tr></thead>
          <tbody>
            ${data.prepays.map(
              (p) => html`<tr>
                <td>${timeAgo(p.recordedAt)}</td>
                <td class="num">${rupees(p.amountPaise)}</td>
                <td class="num">${p.coinsPerRupee}/₹</td>
                <td class="num">${num(p.coins)}</td>
                <td>${METHODS[p.method] ?? p.method}</td>
                <td><code>${p.paymentReference}</code></td>
                <td>
                  ${p.status === 'confirmed'
                    ? html`<span class="tag live">confirmed</span>`
                    : p.status === 'rejected'
                      ? html`<span class="tag susp">rejected</span> <span class="small">${p.rejectReason ?? ''}</span>`
                      : html`<span class="tag flag">pending</span>`}
                </td>
              </tr>`,
            )}
          </tbody>
        </table></div>`}

    <h2>Status history</h2>
    ${a.statusHistory.length === 0
      ? html`<div class="card empty">Never changed.</div>`
      : html`<div class="card"><table>
          <thead><tr><th>When</th><th>From</th><th>To</th><th>Why</th></tr></thead>
          <tbody>
            ${a.statusHistory.map(
              (h) => html`<tr><td>${timeAgo(h.createdAt)}</td><td>${h.fromStatus}</td><td><strong>${h.toStatus}</strong></td><td>${h.reason}</td></tr>`,
            )}
          </tbody>
        </table></div>`}

    <h2>Recent transfers</h2>
    ${data.transfers.length === 0
      ? html`<div class="card empty">This agency has not sent any coins.</div>`
      : transfersTable(data.transfers)}
  `;
}
