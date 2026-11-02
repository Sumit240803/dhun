// The Metrics screen (build-plan M21 slice 5).
//
// Four tables, each answering one question the data plan asks every morning:
// are people coming, where do they stop, is money arriving, do they come back.
// The money columns come from purchases, gift_sends and room_sessions — the
// ledger's own tables — and never from what an app reported.

import type { Cohort, DayActive, DayMoney, FunnelStep } from '../modules/telemetry/index.js';
import { html, type SafeHtml } from './html.js';

const n = (v: number) => v.toLocaleString('en-IN');
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
const pct = (part: number, whole: number) => (whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : '—');
const bp = (v: number | null) => (v === null ? '—' : `${(v / 100).toFixed(2)}%`);

function funnelTable(f: { day: string; steps: FunnelStep[] }): SafeHtml {
  const first = f.steps[0]?.people ?? 0;
  return html`<div class="card"><table>
    <thead><tr><th>Step</th><th>People</th><th>Of those who opened</th></tr></thead>
    <tbody>
      ${f.steps.map(
        (s) => html`<tr>
          <td>${s.step}. ${s.name}</td>
          <td><strong>${n(s.people)}</strong></td>
          <td>${s.step === 1 ? '' : pct(s.people, first)}</td>
        </tr>`,
      )}
    </tbody>
  </table>
  <p class="small">Steps 1–3 count devices from app events. Steps 4–5 count accounts from the
  purchases and gifts tables. Each step is "did this on the day", not a strict cohort.</p></div>`;
}

function activeTable(rows: DayActive[]): SafeHtml {
  if (rows.length === 0) return html`<div class="card empty">No app events yet.</div>`;
  return html`<div class="card"><table>
    <thead><tr><th>Day (IST)</th><th>Devices</th><th>Signed-in accounts</th></tr></thead>
    <tbody>
      ${rows.map((r) => html`<tr><td>${r.day}</td><td>${n(r.devices)}</td><td>${n(r.signedIn)}</td></tr>`)}
    </tbody>
  </table></div>`;
}

function moneyTable(rows: DayMoney[]): SafeHtml {
  return html`<div class="card"><table>
    <thead><tr>
      <th>Day (IST)</th><th>Gross</th><th>Payers</th><th>Payer rate</th>
      <th>Gifts</th><th>Room hours</th><th>Coins per room hour</th>
    </tr></thead>
    <tbody>
      ${rows.map(
        (r) => html`<tr>
          <td>${r.day}</td>
          <td><strong>${rupees(r.grossPaise)}</strong></td>
          <td>${n(r.payers)}</td>
          <td>${bp(r.payerRateBp)}</td>
          <td>${n(r.gifts)}</td>
          <td>${r.roomHours.toFixed(1)}</td>
          <td>${r.coinsPerRoomHour === null ? '—' : n(r.coinsPerRoomHour)}</td>
        </tr>`,
      )}
    </tbody>
  </table>
  <p class="small">Payer rate is payers over signed-in accounts active that day. The model assumes 4% of
  monthly actives pay; a daily rate reads lower.</p></div>`;
}

function retentionTable(rows: Cohort[]): SafeHtml {
  if (rows.length === 0) return html`<div class="card empty">No cohorts yet.</div>`;
  return html`<div class="card"><table>
    <thead><tr><th>First seen (IST)</th><th>Devices</th><th>Back next day</th><th>Back on day 7</th></tr></thead>
    <tbody>
      ${rows.map(
        (r) => html`<tr>
          <td>${r.cohort}</td>
          <td>${n(r.devices)}</td>
          <td>${n(r.d1)} <span class="small">${pct(r.d1, r.devices)}</span></td>
          <td>${n(r.d7)} <span class="small">${pct(r.d7, r.devices)}</span></td>
        </tr>`,
      )}
    </tbody>
  </table>
  <p class="small">A recent cohort reads low on day 7 until seven days have passed.</p></div>`;
}

export function metricsPage(data: {
  funnel: { day: string; steps: FunnelStep[] };
  active: DayActive[];
  money: DayMoney[];
  cohorts: Cohort[];
}): SafeHtml {
  return html`
    <h1>Metrics</h1>
    <p class="sub">
      Days are IST. App events are kept 90 days and archived nightly; money is read from the ledger's
      tables and is never estimated.
    </p>
    <h2>Yesterday, ${data.funnel.day}: from app opened to first gift</h2>
    ${funnelTable(data.funnel)}
    <h2>Money, last 14 days</h2>
    ${moneyTable(data.money)}
    <h2>Active, last 14 days</h2>
    ${activeTable(data.active)}
    <h2>Retention by first day seen</h2>
    ${retentionTable(data.cohorts)}
  `;
}
