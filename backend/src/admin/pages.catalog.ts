// The catalog page: gift prices, coin packs, and the three dials that decide
// what free coins cost us. Every row is a form; every form takes a reason.

import type { AdminGift, AdminPack } from '../modules/config/index.js';
import type { ColdStartConfig } from '../modules/config/index.js';
import { html, type SafeHtml } from './html.js';
import { num, rupees } from './pages.agencies.js';

function csrfField(csrf: string): SafeHtml {
  return html`<input type="hidden" name="csrf" value="${csrf}" />`;
}

const EFFECTS: Record<string, string> = {
  basic: 'in chat',
  fullscreen: 'full screen',
  room_banner: 'room banner',
  global_announcement: 'every room',
};

export interface FreeCoinsDial {
  signup: number;
  checkinLadder: number[];
  watch: { coins: number; minutes: number; dailyCap: number };
  referral: { coins: number; minPurchasePaise: number; attachWindowDays: number };
}

export interface NewUserDial {
  windowDays: number;
  tasks: { follow: number; gift: number; chat: number };
}

export function catalogPage(data: {
  gifts: AdminGift[];
  packs: AdminPack[];
  freeCoins: FreeCoinsDial | null;
  newUser: NewUserDial | null;
  coldStart: ColdStartConfig | null;
  csrf: string;
}): SafeHtml {
  return html`
    <h1>Catalog</h1>
    <p class="sub">
      What a gift costs, what a pack gives, and what we hand out for free. Changes take effect
      on the next catalog fetch — no release. Every save is recorded with your name and the
      reason. Nothing here re-prices anything already bought or sent.
    </p>

    <h2>Gifts</h2>
    <p class="sub">
      Price changes how many gifts a balance buys and nothing else — the payout ratio is set by
      coins-per-rupee in the packs. <strong>Payout</strong> is per gift (60% is the base; 70% for
      an event) and applies to gifts sent from now on. Switching a gift off hides it from the
      tray; the id stays, because every past send points at it.
    </p>
    <div class="card"><table>
      <thead><tr><th>Gift</th><th>Tier</th><th>Plays</th><th>Price (coins)</th><th>Payout (bp)</th><th>On</th><th>Why</th><th></th></tr></thead>
      <tbody>
        ${data.gifts.map(
          (g) => html`<tr class="${g.isActive ? '' : 'off'}">
            <td><strong>${g.name}</strong><br /><code>${g.id}</code></td>
            <td class="num">${g.tier}</td>
            <td class="desc">${EFFECTS[g.effect] ?? g.effect}</td>
            <td colspan="5" class="form-row">
              <form method="post" action="/admin/catalog/gift">
                ${csrfField(data.csrf)}
                <input type="hidden" name="id" value="${g.id}" />
                <input type="text" name="coinPrice" class="num" inputmode="numeric" value="${String(g.coinPrice)}" aria-label="Price in coins" />
                <input type="text" name="payoutRateBp" class="num" inputmode="numeric" value="${String(g.payoutRateBp)}" aria-label="Payout in basis points" />
                <label class="check"><input type="checkbox" name="isActive" ${g.isActive ? 'checked' : ''} /> on</label>
                <input type="text" name="reason" class="short" placeholder="Why (recorded)" required minlength="3" />
                <button>Save</button>
              </form>
            </td>
          </tr>`,
        )}
      </tbody>
    </table></div>

    <h2>Coin packs</h2>
    <p class="sub">
      The price here is what the app shows and what the web gateway charges. The Play Store price
      is set in the Play Console and must be moved by hand to match — a pack whose two prices
      disagree is a refund request. Totals are deliberately awkward so a balance never lands
      exactly on a gift price.
    </p>
    <div class="card"><table>
      <thead><tr><th>Pack</th><th>Play product</th><th>Price (₹)</th><th>Coins</th><th>Gems</th><th>On</th><th>Why</th><th></th></tr></thead>
      <tbody>
        ${data.packs.map(
          (p) => html`<tr class="${p.isActive ? '' : 'off'}">
            <td><strong>${p.name}</strong><br /><code>${p.id}</code>${p.lifetimeOnce ? html` <span class="tag flag">once</span>` : ''}</td>
            <td class="desc"><code>${p.playProductId ?? '—'}</code></td>
            <td colspan="6" class="form-row">
              <form method="post" action="/admin/catalog/pack">
                ${csrfField(data.csrf)}
                <input type="hidden" name="id" value="${p.id}" />
                <input type="text" name="rupees" class="num" inputmode="decimal" value="${(p.pricePaise / 100).toString()}" aria-label="Price in rupees" />
                <input type="text" name="coins" class="num" inputmode="numeric" value="${String(p.coins)}" aria-label="Coins" />
                <input type="text" name="gems" class="num" inputmode="numeric" value="${String(p.gems)}" aria-label="Gems" />
                <label class="check"><input type="checkbox" name="isActive" ${p.isActive ? 'checked' : ''} /> on</label>
                <input type="text" name="reason" class="short" placeholder="Why (recorded)" required minlength="3" />
                <button>Save</button>
              </form>
            </td>
          </tr>`,
        )}
      </tbody>
    </table></div>

    <h2>Free coins</h2>
    <p class="sub">
      Real money: every free coin gifts to a host at the full payout rate. The budget is 8% of
      paid revenue; when it is breached, cut <strong>watch</strong> first, then referral
      (economy-design-v1 § 6).
    </p>
    ${data.freeCoins === null
      ? html`<div class="card empty">The <code>free_coins</code> row is missing or malformed; the service is running on its defaults.</div>`
      : html`<div class="card">
          <form method="post" action="/admin/catalog/dial/free_coins" class="fields">
            ${csrfField(data.csrf)}
            <div><label for="fcSignup">Welcome bonus (coins)</label><input id="fcSignup" type="text" name="signup" class="num" value="${String(data.freeCoins.signup)}" /></div>
            <div class="wide"><label for="fcLadder">Check-in ladder, day 1 to 7 (coins, comma-separated)</label><input id="fcLadder" type="text" name="checkinLadder" value="${data.freeCoins.checkinLadder.join(', ')}" /></div>
            <div><label for="fcWatchCoins">Watch reward (coins per interval)</label><input id="fcWatchCoins" type="text" name="watchCoins" class="num" value="${String(data.freeCoins.watch.coins)}" /></div>
            <div><label for="fcWatchMin">Interval (minutes)</label><input id="fcWatchMin" type="text" name="watchMinutes" class="num" value="${String(data.freeCoins.watch.minutes)}" /></div>
            <div><label for="fcWatchCap">Intervals per day</label><input id="fcWatchCap" type="text" name="watchDailyCap" class="num" value="${String(data.freeCoins.watch.dailyCap)}" /></div>
            <div><label for="fcRefCoins">Referral reward (coins)</label><input id="fcRefCoins" type="text" name="referralCoins" class="num" value="${String(data.freeCoins.referral.coins)}" /></div>
            <div><label for="fcRefMin">Friend's first purchase at least (₹)</label><input id="fcRefMin" type="text" name="referralMinRupees" class="num" value="${(data.freeCoins.referral.minPurchasePaise / 100).toString()}" /></div>
            <div><label for="fcRefDays">Code can be entered within (days of signup)</label><input id="fcRefDays" type="text" name="referralAttachWindowDays" class="num" value="${String(data.freeCoins.referral.attachWindowDays)}" /></div>
            <div class="wide"><label for="fcReason">Why (recorded)</label><input id="fcReason" type="text" name="reason" required minlength="3" maxlength="500" /></div>
            <div class="wide actions"><button class="warn">Save free coins</button></div>
          </form>
        </div>`}

    <h2>New-user rewards</h2>
    <p class="sub">
      The first-week sheet. The window runs from account creation and never restarts; set a
      task to 0 to hide it, or the window to 0 to switch the sheet off.
    </p>
    ${data.newUser === null
      ? html`<div class="card empty">The <code>new_user_rewards</code> row is missing or malformed.</div>`
      : html`<div class="card">
          <form method="post" action="/admin/catalog/dial/new_user_rewards" class="fields">
            ${csrfField(data.csrf)}
            <div><label for="nuDays">Window (days from signup)</label><input id="nuDays" type="text" name="windowDays" class="num" value="${String(data.newUser.windowDays)}" /></div>
            <div><label for="nuFollow">First follow (coins)</label><input id="nuFollow" type="text" name="follow" class="num" value="${String(data.newUser.tasks.follow)}" /></div>
            <div><label for="nuGift">First gift (coins)</label><input id="nuGift" type="text" name="gift" class="num" value="${String(data.newUser.tasks.gift)}" /></div>
            <div><label for="nuChat">First live-room message (coins)</label><input id="nuChat" type="text" name="chat" class="num" value="${String(data.newUser.tasks.chat)}" /></div>
            <div class="wide"><label for="nuReason">Why (recorded)</label><input id="nuReason" type="text" name="reason" required minlength="3" maxlength="500" /></div>
            <div class="wide actions"><button class="warn">Save new-user rewards</button></div>
          </form>
        </div>`}

    <h2>Cold start</h2>
    <p class="sub">
      growth-plan-v1's launch rules: show a few full rooms rather than many thin ones, hide
      small viewer counts, name the peak hours, drop a new user into the fullest room. Switch
      each off on its own once the app has enough rooms not to need it.
    </p>
    ${data.coldStart === null
      ? html`<div class="card empty">The <code>cold_start</code> row is missing or malformed; the rules are OFF.</div>`
      : html`<div class="card">
          <form method="post" action="/admin/catalog/dial/cold_start" class="fields">
            ${csrfField(data.csrf)}
            <div><label for="csMax">Rooms shown per feed (blank = no cap)</label><input id="csMax" type="text" name="maxFeedRooms" class="num" value="${data.coldStart.maxFeedRooms === null ? '' : String(data.coldStart.maxFeedRooms)}" /></div>
            <div><label for="csStart">Peak starts (IST, HH:MM)</label><input id="csStart" type="text" name="peakStartIst" class="num" value="${data.coldStart.peakStartIst}" /></div>
            <div><label for="csEnd">Peak ends (IST, HH:MM)</label><input id="csEnd" type="text" name="peakEndIst" class="num" value="${data.coldStart.peakEndIst}" /></div>
            <div><label class="check"><input type="checkbox" name="hideViewerCounts" ${data.coldStart.hideViewerCounts ? 'checked' : ''} /> Hide viewer counts</label></div>
            <div><label class="check"><input type="checkbox" name="dropNewUsersIntoRoom" ${data.coldStart.dropNewUsersIntoRoom ? 'checked' : ''} /> Drop a new user into the fullest room</label></div>
            <div class="wide"><label for="csReason">Why (recorded)</label><input id="csReason" type="text" name="reason" required minlength="3" maxlength="500" /></div>
            <div class="wide actions"><button class="warn">Save cold start</button></div>
          </form>
        </div>`}

    <p class="sub" style="margin-top:20px">
      Totals for reference: ${num(data.gifts.filter((g) => g.isActive).length)} gifts on,
      ${num(data.packs.filter((p) => p.isActive).length)} packs on; the cheapest pack is
      ${data.packs.length ? rupees(Math.min(...data.packs.map((p) => p.pricePaise))) : '—'}.
    </p>
  `;
}
