# What works today — demo and status

Verified 2026-10-06 by running the backend and driving the real endpoints, not
from the plan. Where something is blocked, the reason is an external account we
do not have yet, not unfinished code.

---

## Summary

| | |
|---|---|
| Screens in the app | 35 |
| Fully built and reading live data | 30 |
| Placeholders | 5 — the four legal pages (text not written) and the wallet transaction list |
| Backend endpoints | ~95 |
| Automated tests | 453 backend, 117 app, all passing |

The whole money loop works end to end. Verified live today: a user signed up by
phone, claimed 1,000 free coins, a host went live, the user sent a x10 Rose
combo (900 coins), and the host was credited 540 points — exactly the 60% the
economy specifies.

---

## Demo in full — nothing extra needed

Backend plus Postgres only. All of this reads and writes real data.

**Sign up and account**
- Phone sign-up with OTP. In a development build the code appears on screen, so
  no SMS account is needed to demonstrate it.
- Email sign-up, sign-in, forgot password, reset password, email confirmation.
- Profile setup — display name, date of birth, 18+ gate.
- Account and security — change password, change phone number, list signed-in
  devices and sign one out, delete account.

**Browse and social**
- Home feed and Party feed — live rooms, following and explore.
- Discover — search people by name or by public ID.
- Public profile, profile visitors, follow.
- Messages and a message thread.
- Me tab — public ID, level, earned points, equipped cosmetics.

**Economy**
- Wallet — coin and gem balance, the six coin packs with prices.
- Store — the cosmetics catalogue, bought with gems, equipped and worn.
- Daily rewards — welcome bonus, 7-day check-in ladder, watch reward, referral
  code with share.
- Gifting — the 20-gift catalogue across five tiers, combo multipliers
  (x1 / x10 / x99 / x520 / x999), the host credited in points on every send.

**Agency network (complete)**
- Join an agency by typing an Agent ID, or accept an invitation sent to your
  User ID and Host Code.
- My Agency — your agency, agent, owner and join date.
- Leave the agency — the five rules shown up front, the owner's decision, the
  7-day automatic release.
- Agent side — the roster with each agent's host count, invite an agent, remove
  one (their hosts move to the owner), grant or withdraw agent management.
- Coin stock — the agency's inventory, send coins to a user by User ID with a
  confirmation step, the transfer history.
- Commission — the rate already fixed for this month, the volume building
  towards next month's rate, and what has been paid.

---

## Needs one more thing before it can be shown

| Feature | What is missing | Effort |
|---|---|---|
| **Live audio in a room** | A LiveKit URL and key, and a development build rather than Expo Go | LiveKit Cloud has a free tier — about an hour |
| **Two phones seeing each other's chat and gifts** | Redis running (`npm run docker:up`), plus the gateway process (`npm run gateway`) | Minutes, if Docker is available |
| **Buying coins** | The Google Play developer account. The Recharge button deliberately says "unavailable" rather than failing silently | Blocked on incorporation |
| **Push notifications** | Firebase credentials for Android | Blocked on the Play account |
| **The four legal screens** | The actual text, which needs a lawyer | Not an engineering task |
| **Wallet transaction list** | Not built — the endpoint exists | Half a day |

**The room screen itself still works without LiveKit.** Seats, chat, the gift
strips and the full-screen gift animations all run over the WebSocket gateway.
Only the audio is missing.

---

## Suggested recording order

Roughly twelve minutes, and it avoids every blocked path.

1. **Sign up** by phone — the code appears on screen; set a name and date of
   birth.
2. **Daily rewards** — claim the welcome bonus, 1,000 coins. Show the check-in
   ladder.
3. **Wallet** — the balance, and the six coin packs with their real prices.
4. **Store** — buy a cosmetic with gems and wear it.
5. **Join an agency** — type the Agent ID; on a second account, accept it as the
   agent. Show the roster updating.
6. **Agency sends coins** — from the agency's coin stock, transfer coins to the
   first account by User ID. Show it arriving in that user's wallet, and the
   receipt on both sides. *This is also how to fund the account for the next
   step without needing Play billing.*
7. **Go live** on the host account, join from the other.
8. **Send a gift** — a x10 or x99 combo. Show the strip, the animation, and the
   host's points going up.
9. **Commission** — on the agency account, show the rate fixed for this month
   and the volume building towards next month.
10. **My Agency → leave** — show the five rules and the owner's approval queue.

If the gateway and Redis are running, do steps 7 and 8 on two phones side by
side. If not, one phone still shows everything except another person's chat
arriving live.

---

## Running it

```bash
# once, after pulling
npm run migrate            # the dev database was 10 migrations behind

docker compose up -d postgres redis   # Redis is needed only for two-device rooms
npm run dev                # API        :3000
npm run gateway            # WebSocket  :3001
npm run worker             # background jobs (optional for a demo)
npm run app                # Expo
```

The app's `EXPO_PUBLIC_API_URL` must be the development machine's **LAN
address**, not `localhost` — a phone resolves `localhost` to itself. The config
warns about this at launch.

---

## Honest notes for the client

- **Nothing has been run on a physical device yet.** Everything above is
  verified against the real backend, and the app compiles and passes its tests,
  but rooms, gifting, cosmetics and the daily rewards have not been exercised on
  a handset. That is the next step and the one real unknown.
- **Artwork is stand-in.** Gifts and cosmetics use placeholder images. The real
  Lottie animations are commissioned separately and swap in last.
- **Host payouts are not built.** Hosts and agencies accumulate points
  correctly, but withdrawing to a bank account is the next milestone and is
  waiting on a tax ruling and a RazorpayX account.
- **One bug was found and fixed during this check:** a host's earned points
  always displayed as zero on their own profile, because the summary read an
  account that does not exist. Fixed, with a test.
