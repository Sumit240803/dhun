# Dhun — Project Memory

**Dhun** (*dhun* — melody, tune), by **Dhunlive Private Limited**.

| | |
|---|---|
| App | **Dhun** |
| Company | **Dhunlive Private Limited** |
| Company domain | `dhunlive.in` |
| App domain | `dhun.live` — reads as the brand plus the TLD |
| Package | **`com.dhunlive.dhun`** |

The package identifier is the one string that can never change after the first Play Store
upload. A later app rename leaves it harmless, exactly as `com.twitter.android` survived the
move to X.

Still to verify before filing: MCA name search for **Dhunlive** (bare *Dhun* is a common
Hindi word, so expect existing companies — *Dhunlive* is the distinctive part), IP India
classes 9/38/41, and the **Play Store listing title**, which is first-come and where a short
common word is most likely already taken.

India-first live streaming + voice/video party room social app (Bigo Live / Poppo Live
model) with a virtual gifting economy. Solo founder in Delhi (full-stack: React Native +
Expo, backend design, cloud infra) plus one partner; team expands after launch.

**Money flow:** users buy coins with real money → gift them to hosts → hosts earn points
→ hosts withdraw INR. The platform keeps the spread.

---

## Reading the source documents

Seven PDFs in `documents/` hold every decision and number made so far. **The Read tool
cannot extract their text on this machine** — poppler/`pdftoppm` is not installed, and the
files use subset fonts with custom encodings that produce garbage from naive extraction.
Use the working extractor (inflates content streams, resolves `/ToUnicode` CMaps, expands
PDF 1.5 object streams, tracks the text matrix for line breaks):

```powershell
node "C:\Users\Acer\.claude\tools\pdftext.js" "documents/<file>.pdf" | Out-File -Encoding utf8 out.txt
```

| Document | Contents |
|---|---|
| `PROJECT-CONTEXT.pdf` | Master summary of everything below — read this first |
| `app-blueprint-v1.pdf` | Roles, features by phase, revenue model |
| `economy-design-v1.pdf` | Coin packs, gift catalog, cosmetics, level curves, commission |
| `payout-operations-v1.pdf` | Verification, hold periods, TDS, GST, approvals, reconciliation |
| `trust-and-safety-v1.pdf` | Policy levels, detection, moderation, appeals, fraud |
| `data-and-launch-plan-v1.pdf` | Event taxonomy, dashboards, launch phases, store submission |
| `growth-plan-v1.pdf` | Host seeding, user acquisition, agency network, retention |

Docs are written in Hinglish. **All numbers are starting points**, to be retuned about
three months after launch.

---

## HARD RULES — never violate these

1. **No paid chance-based game, ever.** No lucky boxes, mystery gifts, lucky wheel,
   Golden Flower, "provably-fair RNG". India's Promotion and Regulation of Online Gaming
   Act 2025 (rules in force 1 May 2026) bans online money games and erased the
   skill-vs-chance distinction. Treated as existential risk.
2. **An agency never holds a host's money.** The platform pays each host directly;
   agency commission is paid separately, by the platform, out of platform funds. If money
   routed through an agency it would become an RBI Payment Aggregator (PSS Act 2007 —
   ₹15cr net worth + escrow).
3. **A reseller pays before receiving coins.** Never on credit. Pay-first = distributor
   (legal); pay-later = payment intermediary (illegal).
4. **Never the word "salary"** for hosts — use "earnings" or "payout". No mandated hours,
   penalties, or forced exclusivity (employment-classification risk: PF, ESI, gratuity).
5. **18+ only.** PAN + face match mandatory before any payout. A minor host is an
   existential risk.
6. **India-resident Grievance Officer**, contact publicly published (IT Rules 2021).
7. **Never build user-to-user coin or gem transfer.** Not in the source docs and must stay
   out. The moment currency moves between users it becomes a payment instrument — RBI
   prepaid-instrument exposure, plus it is the standard laundering route for gift-economy
   currency. Expect this to come back as a harmless-sounding feature request.

**The one allowed transfer, and why it is not a hole in rule #7:** an approved **agency
(reseller)** may move coins from its own prepaid **inventory account to a user**, because it
bought those coins from us with its own money first and is selling them on as a distributor.
That is one-directional and closed: never user→user, never user→agency, never agency→agency,
and there is no route back. Generalising it in any direction re-creates the payment
instrument rule #7 exists to prevent.

**Unresolved contradiction:** `app-blueprint-v1.pdf` lists a **lucky wheel** under Phase 1
daily hooks. If it costs coins to spin, it is a paid chance-based game and breaks hard rule
#1. Only acceptable as a *free* daily spin awarding coins (a `free_coin_grant` subtype).
Settle this before anyone builds it.

Store-fee note: Google Play India's alternative billing gives only a 4% reduction. Google
dropped anti-steering worldwide, but a purchase within 24 hours of an in-app link click
still incurs 20%. The web recharge portal must therefore be **independently discoverable**
(SEO, WhatsApp, reseller channels), not driven from inside the app.

---

## Roles — host, agent, agency

Set by the founder, 2026-09-27. These words are load-bearing: they become role names,
tables and permissions. `role_assignments` already carries `coin_reseller`; M12 adds the
rest.

### Host

A user who goes live to show a skill, talk to an audience and complete daily tasks. Hosts
entertain, engage, and receive virtual gifts bought with real money — the core of the
revenue model. A host keeps a significant share of the gifts they earn, **up to 70%**, and
**joins an agency with an Agent ID to start earning officially**.

### Agent

The person who runs and supervises a team of hosts: finding, inviting, onboarding and
supporting new streamers, helping them be more productive, and keeping them inside the
platform's rules. An agent earns commission on the **total earnings and productivity of the
hosts under them**.

### Agency

The organisation an agent creates and manages on the platform — the guild layer between
individual hosts and us. It must:

- manage and support its roster of hosts;
- recruit and onboard new hosts;
- keep its hosts compliant with platform policy;
- never poach hosts from another agency;
- assist with host management and payout processing;
- watch the productivity and performance of its hosts.

### Three places these definitions meet an existing rule

1. **"Assist with payout processing" means paperwork, never money.** Hard rule #2: the
   platform pays every host directly, and agency commission is paid separately out of
   platform funds. An agency helping a host finish KYC is support; an agency receiving a
   host's earnings to pass on is an RBI payment aggregator.
2. **"Up to 70%" is the advertised dial, not the paid one — and it is not yet decided.**
   The economy below advertises **60% of the coin count** and pays ~30% in rupees, because a
   point is worth half a coin. Moving the advertised number to 70% at today's point rate
   takes the real payout to ~35% and costs about five points of margin. Settle it before
   any host is told a number.
3. **"Must join an agency to earn" collides with platform-seeded hosts.** The growth plan
   has us recruiting the first 30–50 hosts ourselves, months before an agency network
   exists. Either those hosts sit in an in-house default agency, or they cannot be paid.

## Economy — as decided (supersedes `economy-design-v1.pdf` where they differ)

The source doc had **one** spendable currency with a paid/bonus split. That was replaced in
design discussion with **three currencies**. Where this section and the PDF disagree, this
section wins.

### The three currencies

| Currency | Source | Use | Host payout |
|---|---|---|---|
| **Coins** | Purchased in packs, **or earned free** (signup, check-in, watch, follow, share, referral) | Gift to hosts | 60% of coin count, as points |
| **Gems** | Pack bonus, or converted from coins | Cosmetics **only** | **Zero** |
| **Points** | Hosts earn from gifts | Withdraw as INR | — |

Free coins are ordinary coins — no separate balance, no 20% tier, no expiry. Their whole
job is engagement and referral, and the payout cost (~2.4% of revenue against the ≤8%
budget) is accepted as retention spend.

### Rates

| | |
|---|---|
| Pack rate | **55 coins = ₹1** (was 65 — this is the margin dial) |
| Accounting face value | 65 units = ₹1, for deferred revenue only |
| Point rate | 130 points = ₹1 |
| Gift split | 60% of the gift's **coin count**, issued as points |
| **Payout formula** | **`points = coins × payout_rate`** — no ×2. Points are worth half a coin, which is what turns an advertised 60% into a real 30%. |
| Coins → Gems conversion | one-way, **+20%** (`coin_to_gem_rate: 12000` bp), config-driven |
| Effective payout | 25.4% from packs, +2.4% from free coins = **~27.8% blended** |

**Two-dial mechanic:** dial 1 is the gift split % (the public marketing number); dial 2 is
the point-to-rupee rate (hidden in the wallet). Together they advertise 60% while paying
out ~30%. The point rate is the **last** lever to touch — hosts notice immediately.

**Payout ratio is set by one number only:** `coins per ₹ ÷ 216.7`. Gift prices and cosmetic
prices do not affect it — they only change how many gifts a given balance buys.

### Coin distribution channels

Two paths reach a user's coin balance, and most users take the second.

| Path | Who really uses it | Money reaches us | Built |
|---|---|---|---|
| **Direct top-up** — IAP, web gateway, (crypto: open) | **Agencies buying inventory**, at a ₹10,000 floor. A retail user buying a ₹99 pack in the app is the Play-billing path and stays | Directly, up front | Packs yes, agency prepay M12 |
| **Agency resale** | Almost every user. Pays the agency by UPI/Paytm/bank **off-platform**, receives coins in-app | Earlier, when the agency prepaid | M12 |

The platform's spread is taken once, at wholesale. The agency's margin is whatever it
charges above that. Revenue is still recognised only when a coin is **spent**, so a transfer
from an agency to a user moves no money on our books (ledger-decisions § C3/C4).

**Wholesale rate — OPEN, and it sets the payout ratio.** Payout ratio is `coins per ₹ ÷
216.7`, so the wholesale rate does to the agency channel what the pack rate does to retail:

| Wholesale rate | Agency margin reselling at 55/₹ | Our payout ratio on those coins |
|---|---|---|
| 62 coins/₹ | 13% | 28.6% |
| 66 coins/₹ | 20% | 30.5% |
| 70 coins/₹ | 27% | 32.3% |
| ~88 coins/₹ *(an earlier note, not a decision)* | 60% | **40.6% — do not** |

Recommended: **62 / 66 / 70 coins per ₹ in volume tiers** (₹10,000 / ₹50,000 / ₹2,00,000+),
config-driven like every other rate. It keeps the blended payout near the 30% the model
assumes while leaving an agency a real margin for collecting small payments and doing the
support that comes with them.

### Coin packs

| Pack | Price | Coins | Gems | Total | Gem share |
|---|---|---|---|---|---|
| Starter (lifetime once) | ₹19 | 2,000 | 3,300 | 5,300 | 62% |
| Small | ₹99 | 5,445 | 1,305 | 6,750 | 19% |
| Popular | ₹299 | 16,445 | 5,355 | 21,800 | 25% |
| Value | ₹999 | 54,945 | 23,055 | 78,000 | 30% |
| Big | ₹2,999 | 164,945 | 84,555 | 249,500 | 34% |
| Whale | ₹9,999 | 549,945 | 327,555 | 877,500 | 37% |

Totals are unchanged from the source doc, so advertised value is preserved — only the
coin/gem split is new. Starter is deliberately **off-formula** (105 coins/₹, a loss leader
netting ~₹4) because its job is teaching the gifting loop, not margin. Totals stay
deliberately awkward so a balance never lands exactly on a gift price.

### Gift catalog — REPRICED for 55 coins/₹ (supersedes the source doc)

Gift prices do **not** affect the payout ratio — that is set only by coins-per-₹ in the
packs. Repricing changes how many gifts a balance buys, nothing else. The ladder below was
rebuilt so **every pack affords a hero gift and then cascades down to an awkward
remainder**.

| Tier | Gift | Coins | ≈₹ |
|---|---|---|---|
| 1 Impulse | Heart · Rose · Chai · Laddu · Clap | 10 · 45 · 85 · 165 · 250 | 0.18–4.55 |
| 2 Regular | Perfume · Teddy · Guitar · Cake · Bouquet | 520 · 999 · 1,250 · 1,650 · 2,200 | 9.45–40 |
| 3 Statement *(full-screen)* | **Scooter** · Fireworks · Motorbike · Diamond ring · Yacht | 3,300 · 4,150 · 6,600 · 9,900 · 15,500 | 60–282 |
| 4 Flex *(room banner)* | Sports car · Private jet · Castle | 45,000 · 82,500 · 145,000 | 818–2,636 |
| 5 Global *(all-rooms)* | Rocket · Galaxy | 400,000 · 825,000 | 7,273 · 15,000 |

**Scooter (3,300) is new** — it bridges the Tier 2 → 3 gap the source doc predicts will
break first, and it is the cheapest full-screen gift.

Pack cascades: ₹99 → Fireworks + Guitar + Rose · ₹299 → Yacht + Perfume + 2 Laddu ·
₹999 → Sports car + Diamond ring · ₹2,999 → Castle + Yacht + Fireworks ·
₹9,999 → Rocket + Castle + Fireworks. Galaxy deliberately needs two whale packs.

**Perfume 520 and Teddy 999 keep their prices** — they echo the sentimental combo
multipliers. Combo multipliers x1 → x10 → x99 → x520 → x999 are unchanged, single-tap,
no confirmation dialog.

**Round-rupee anchors were dropped on Yacht, Castle and Rocket.** With packs at ₹299 /
₹2,999 and gifts at ₹300 / ₹3,000, every hero gift landed *exactly ₹1* out of reach —
which reads as a trick, not aspiration.

**Cosmetics** are priced in Gems, unchanged from the source doc. The +20% conversion bonus
almost exactly offsets the 55/₹ rate (₹1 → 55 coins → 66 gems vs the original 65), so every
cosmetic still lands within 1.5% of its designed rupee price. Everything expiring — VIP
monthly tiers ₹100/₹500/₹2,000/₹10,000, plus frames, bubbles, entry effects, nickname
colour, super message.

**User level** accrues on **purchase**, not on spend — otherwise free coins could be ground
into levels via daily check-ins. Small deviation from the source doc's wording, same intent.

**Agency commission** on trailing-30-day host earnings: 5% / 8% / 12% / 16% / 20% across
₹0–50K / 50K–2L / 2L–5L / 5L–15L / 15L+. Recalculated monthly, never retroactive. No
commission on daily/task/reward earnings. Paid by the platform, never deducted from
the host.

### Corrections to the source docs' arithmetic

Both carried into the financial model — tell the CA:

1. The ₹1,000 revenue table and the 22–25% blended payout target were both calculated at
   face value (65 coins/₹) and **ignore pack bonuses entirely**. Under the original design
   the real blended payout was ~26–27%, not 23.4%.
2. Host cost per ₹1,000 is **₹254** at 55 coins/₹, not the ₹300 in the doc. On the web
   channel that leaves ~₹501 rather than ₹449.

---

## Architecture — decided

**Modular monolith, single repo.** Chosen deliberately over microservices: the double-entry
ledger needs single-transaction ACID guarantees (splitting economy from payments would mean
sagas over live money), the team is 1–3 backend engineers through 10K DAU, and the infra
budget is ~3.5% of revenue. The seams are already drawn, so extraction stays cheap.

**Three rules of the monolith** (see `backend/README.md`):
1. Modules talk only through their `index.ts`. Never import another module's internals.
2. `economy` is the **sole writer** of wallet balances. Everything else moves money by
   calling its public functions with an idempotency key.
3. Side effects go through the event bus, never direct calls. Swap `infra/eventBus.ts`
   for Kafka later and subscribers move out untouched.

**Three processes, one codebase:** API (REST, `npm run dev`) · realtime gateway (WebSocket —
long-lived connections, scales on concurrency, must deploy independently of the API; M5) ·
workers (`npm run worker`).

The **workers** process is built. It runs the outbox shipper (LISTEN/NOTIFY with a 2s poll
floor), the nightly reconciliation at 03:00 IST, and the retention purges. Jobs take a
Postgres **advisory lock**, so two instances never both run one; every execution is recorded
in `job_runs`, because a job that silently stops is otherwise invisible. Payout batches, TDS
accrual, commission recalc and moderation callbacks join it in M8/M9.
`npm run worker:run <job>` runs one job and exits.

**Extraction triggers, when they arrive:** `realtime`/`rooms` at ~5–10K concurrent;
`moderation` ingest when ML needs its own runtime. **Never split `economy` + `payments`.**

**Stack:** Node + TypeScript (ESM), Express, Postgres, Redis, zod, vitest. RTC media is
**LiveKit** and never transits the backend — the API mints join tokens and receives
webhooks, nothing more. Everything LiveKit-shaped stops at `modules/realtime/`, behind
an `RtcProvider` interface, because the whole argument for LiveKit is being able to
walk away from a vendor and an SDK spread across four modules cannot walk anywhere.

### Standing conventions

- **Postman collection is maintained alongside the code.** `backend/postman/` holds
  `collection.json` (all endpoints, grouped by module) and `environment.json` (base URL,
  tokens, ids as variables — never hardcoded). **Any change to an endpoint — added,
  removed, renamed, new field, new error code — updates the collection in the same
  change.** Every request carries an example body, auth header, and `Idempotency-Key`
  where the endpoint takes money. Treat a stale collection as a broken build.
- **Ledger design decisions** are tracked in `backend/docs/ledger-decisions.md`. Nothing
  in the ledger gets built until its checklist item is resolved there.
- **Engineering standards — apply to every endpoint, every session. Non-negotiable.**

  1. **Security first.** Assume every request is hostile. Rate-limit by IP, device and
     user. Security headers, CORS allowlist, `trust proxy`. Guests may never spend.
     Money endpoints require a registered, verified-adult user. Secrets never in code.
  2. **Handle every error case.** No unhandled rejection, no uncaught exception, no
     unmapped database error, no route without a failure path. Malformed JSON, oversized
     bodies, query timeouts, deadlocks and lost connections all map to a deliberate status
     code — never a stack trace and never a hang.
  3. **Sanitise every message sent to a client.** Clients get a stable `code`, a short
     human message, and field paths for validation failures. They never get SQL, schema
     names, file paths, stack traces, regex sources, or their own input echoed back.
     Internal detail is logged with the `trace_id` and stays server-side.
  4. **Validate every input.** Body, query and route params, all through zod, all
     `.strict()` so unknown keys are rejected rather than ignored. Every string has a max
     length, every number has bounds, every id has a format. Reject prototype-pollution
     keys. Validate for integrity as well as safety — an amount that parses is not the
     same as an amount that makes sense.

- **Screen craft — how every screen must be built. Non-negotiable, same standing as
  the backend engineering standards above.**

  1. **No generic AI-slop pages.** A screen is not a centred card on an empty
     background with a heading and a button. Real hierarchy, real spacing rhythm,
     one clear primary action per screen, and content that starts at the top —
     not floated in the middle of nowhere.
  2. **Consistent layout.** Every screen is a `<Screen>` from `@/ui`. Same
     horizontal padding, same header treatment, same button placement. A user
     moving between two screens should not feel the app change hands.
  3. **Clear text.** Say the thing. "We'll send a 6-digit code to this number"
     beats "Verification required". No filler, no marketing voice, no exclamation
     marks. Every string goes through `t()` in both `en.ts` and `hi.ts`.
  4. **Subtle motion, never decoration.** Reanimated 4. Entrances 150–250ms with
     small offsets (8–16px), springs for anything the finger controls, and motion
     only where it explains a change — an error appearing, a step advancing.
     Nothing bounces, nothing spins, nothing loops.
  5. **Haptics on every meaningful commit.** `expo-haptics`: light on selection,
     success on a completed step, error on a rejected one. Never on scroll,
     never on every keystroke.
  6. **Safe insets always**, via `<Screen edges>`. Full-bleed screens (a room)
     pass `[]` and inset their own chrome.
  7. **Every async state has a design.** Loading, empty, error and offline are
     designed states, not afterthoughts — an empty list says what to do next, an
     error says what happened and offers the retry.
  8. **Errors are handled where they happen.** Field errors go under the field.
     Everything else goes through the shared error mapper, which turns an
     `ApiError` code into a translated sentence. A raw server string never
     reaches a user, and a screen never dead-ends without a way forward.

- **`docs/development-pipeline.md` is how work gets done.** One command before
  every commit: `npm run check` from the repo root. Four things it cannot check —
  Postman updated in the same commit, new strings in both `en.ts` and `hi.ts`, new
  colours as semantic tokens, ledger changes resolved in `ledger-decisions.md`
  first. Incidents: **kill switch first, fix second.**
- **`docs/build-plan.md` governs the work.** Milestones are sequential, exit criteria are
  binary, features ship as vertical slices (backend + app together). Do not start a
  milestone whose dependencies are unmet and do not jump ahead. **A scope change is an edit
  to that file, agreed first — never something that happens inside a coding session.**
  Check it at the start of any build session.

### Day-1 non-negotiables (from the docs)

1. Double-entry ledger: `ledger_accounts` / `ledger_txns` (idempotency_key UNIQUE) /
   `ledger_entries` (signed amounts, sum = 0). **Balances are never a mutable column.**
   Nightly verification job with pager alert.
2. `Idempotency-Key` header on every money endpoint.
3. **Coin float is a liability, not revenue.** Revenue is recognized when a coin is
   *spent*. Tell the CA from day one.
4. API versioning `/v1/` — old app versions stay alive forever.
5. Force-update + remote kill switch per major feature.
6. Server-driven config: gift catalog, coin packs, level thresholds, room types. Adding a
   gift must never require an app release.
7. EAS Update (OTA) for JS-level fixes.
8. Structured logging + `trace_id` from client to DB.
9. Terraform IaC, three environments (dev / staging / prod).
10. Admin panel is part of the MVP, not "later".
11. Kafka event stream from day one, even with a single consumer.
12. `payout_rate` is a **per-gift** field, never a global constant.

---

## Current state

One repo, pushed to `git@github.com:Sumit240803/dhun.git` (`main`).
Verify everything with **`npm run check`** from the root.

### `backend/` — M1, M2 (bar OAuth) and M4 complete; M5, M6, M7 and M10 built, unverified. 360 tests.

Seventeen migrations, 68 routes, and all three processes built: API, workers, and the
realtime gateway. **M10 was built before M8 and M9, by agreement** — both are blocked on
external accounts (CA + RazorpayX, Hive) and neither is skipped.

| Area | State |
|---|---|
| **Ledger** | Done and proven. Unbalanced transactions cannot commit (deferred constraint trigger), entries cannot be mutated (trigger + revoked grants in `ops/roles.sql`), balances cannot go negative. 20 parallel gifts against a 16-gift balance land exactly 16. |
| **Auth** | Complete except OAuth. Phone OTP behind a provider interface (`console` in dev, `msg91` blocked on DLT) plus the MSG91 **widget** path, email + password, deferred email confirmation, password reset and change, session list and per-device revocation, phone-number change, account deletion. JWT + rotating refresh with replay detection that revokes the device chain, scoped `role_assignments`. |
| **Wallet / purchases** | Server-driven catalogs, IAP behind a verifier interface (stub in dev), Razorpay signature verification fully implemented, coins→gems conversion. |
| **Social / chat / moderation** | Follows, profile visits, public profiles, profile summary, message threads, reports and blocks. Bans are enforced on every request, not only at sign-in, and guests are bannable. |
| **Rooms / RTC** | Go live, join, mic seats, host mute and kick, end. Publish rights come from the SEAT TABLE and nowhere else — there is no way to request them. LiveKit webhooks feed viewer counts and `room_sessions` (host hours). Seats, bans and sessions are in Postgres; presence is not mirrored, because it would drift from the media server within seconds. |
| **Gifting** | `POST /v1/gifts/send`: one ledger transaction per tap whatever the combo, registered 18+ only, `Idempotency-Key` required. Recipient is the host or anyone seated; self-gifts, off-stage recipients, blocks, bans, ended rooms and a price the user never saw are refused. Published to the room on commit. Each send writes a `gift_sends` row inside the ledger's own transaction, which the room leaderboard reads. |
| **Cosmetics** | Frames, chat bubbles, nickname colours and entry effects, bought with GEMS only. Time stacks onto an active item; buying equips; one worn per kind; expiry evaluated on read. Ownership and a purchase record are written inside the ledger's transaction. A `look` rides on seats, chat lines, gift senders and profiles; entry effects are announced over the gateway. Styles are validated light/dark data. |
| **Discovery & daily hooks** | Welcome bonus, 7-day check-in ladder, watch reward measured by the gateway, referrals paid on a friend's first ₹99+ purchase — all ordinary coins, all once-only by a claim-derived ledger key, all in `app_config.free_coins`. Search by name prefix or public ID. Followed-host-is-live push via Expo, driven by a `room_started` outbox event, capped and cooled down. Cold-start dials in `app_config.cold_start`. |
| **Workers** | `npm run worker`. Outbox shipper (LISTEN/NOTIFY + 2s poll floor) that also runs consumers (referral payouts, live notifications), nightly reconciliation at 03:00 IST with 10 checks and zero tolerance, the daily `spend_mix` measure at 03:30, five retention purges. Advisory-lock job locking. |
| **Security** | Rate limiting by IP/device/user, security headers, CORS allowlist, 18+ gate on every money endpoint, strict validation of body/query/params, sanitised client errors. |

**Invariants worth never breaking:**

1. The ledger idempotency key for a purchase derives from the **receipt**
   (`provider:provider_txn_id`), not the client header — keying off the header
   let a replayed receipt credit twice.
2. **`points = coins × payout_rate`**, no ×2; a point is worth half a coin,
   which is what turns an advertised 60% into a real 30%.
3. A six-digit code carries a **`purpose`**. `email_verifications` was built that
   way and `otp_challenges` gained it in 012 — it is the only thing stopping a
   code minted for one flow being spent on another.
4. **Deleting an account anonymises, it does not delete the row.** The ledger is
   append-only and its entries point at the user. Clearing the identity frees the
   phone and email for reuse, which is what someone signing up again will do.
5. **An omitted LiveKit grant is a GRANTED one.** `canPublish` left out means
   publish is enabled — so a listener token that forgets the field lets anyone
   talk in anyone's room. Every grant is written explicitly, including the
   `false` ones, and `RtcGrants` has no optional publish field so the dangerous
   default is unreachable.
6. **MSG91 returns HTTP 200 with error bodies.** `response.ok` is true on
   failure; the body's `type` is the real signal. A status-only check would sign
   in anyone who asked. Two credentials, two trust levels: `tokenAuth` ships in
   the app and is PUBLIC (a leak lets someone spend your SMS balance);
   `authkey` is server-only (a leak lets any number be claimed). The authkey
   must never be served to a client, logged, or returned in an error.
7. **A gift's record is written inside the ledger's transaction, not after it.**
   `gift_sends` goes through `postTransaction`'s `withinTransaction` hook, so a
   gift the leaderboard shows can never be missing from the ledger, or the
   reverse. The gift id every client dedupes on IS the ledger transaction id.
   Moving that insert out "for cleanliness" reopens the gap it closes.
   Cosmetic ownership (`user_cosmetics`, `cosmetic_purchases`) follows the same rule.
8. **Cosmetics spend gems and nothing else.** Coins pay hosts 30%; gems pay nothing.
   A cosmetic that fell back to coins when gems ran short would quietly move money
   onto the payout path — and there is a test that gives a user 100,000 coins and
   no gems and expects the purchase to fail.
9. **A free-coin claim's ledger key is derived from the claim, never a client header.**
   `checkin:{user}:{IST date}`, `watch:{user}:{date}:{slot}`, `referral:{referred user}`.
   The same reasoning as purchases keying on the receipt: the claim IS the money event, so
   one claim can only ever be one credit, however it is retried or raced.

### `mobile/` — 31 routes, 23 of them built.

Expo SDK 57 · React Native 0.86 · React 19.2 · expo-router. EAS project
`@sumitsumit/dhun` (`c7c547aa-86e2-4d02-befa-b5e643fde400`). 114 tests.

Read **`mobile/ARCHITECTURE.md`** before adding a file. The essentials:

- **Layering:** `app/` composes → `features/` holds logic → `ui/` `visuals/` present
  → `theme/` `lib/` `api/` `config/` underneath. Never upward.
- **Colour has one source, enforced by lint.** `theme/primitives.ts` (raw, never
  imported by components) → `theme/colors.ts` (semantic, the only colour import).
  A hex literal outside `theme/` is a lint **error**. Currency and gift-tier
  colours are reserved. **`MODE` in `colors.ts` selects the palette; light is the
  default and both palettes are complete.**
- **Every string goes through `t()`**, in both `en.ts` and `hi.ts`. Typed keys, so
  a typo is a compile error. Never concatenate fragments — Hindi is SOV.
- **Money:** branded `Coins`/`Gems`/`Points`/`Paise` types; Indian lakh grouping
  (`1,64,945`, not `164,945`).
- 31 routes exist and are navigable; the 8 unbuilt ones render a placeholder
  naming their milestone. Guards use `Stack.Protected`, never redirect effects.
- **Every screen reads a real endpoint.** The mock layer was deleted once the
  endpoints existed. TanStack Query throughout, keys centralised in
  `api/queries/keys.ts`.

**Built:** the five tabs (home feed, party, discover placeholder, messages, me),
auth (phone, OTP, email sign-in/up, forgot and reset password), profile setup,
email confirmation, account and security (password, phone number, signed-in
devices, delete), wallet, thread, public profile, visitors.

**Adding a route needs the typed-route file regenerated** — it comes from
`expo start`, not from `tsc` or `expo export`, and until it runs a new
`router.push` path is a type error.

**Gift animations are Lottie**, decided by checking what is maintained: both SVGA
React Native bindings died in 2022 and PAG has no RN binding, because every app
using those formats is native Android/iOS. Brief designers for After Effects →
Bodymovin, **and always keep the `.aep` source** — that is what keeps the decision
reversible. Every canvas, budget and Lottie restriction is in **`docs/asset-contract.md`**;
the app runs on stand-in art until real art is swapped in last.

The gift queue **sheds the cheapest gift when full**, never the newest. Dropping a
₹15,000 Galaxy behind two hundred Roses is a refund request.

### Not built yet

OAuth (Google / Facebook / Instagram) · host tools and payouts (M8) · trust & safety (M9) ·
free cosmetic unlocks by level · super messages and VIP · the Tier 5 all-rooms gift broadcast ·
stand-in art files · Firebase credentials for Android push · the legal screens' actual text ·
admin panel · analytics pipeline · CI beyond typecheck and tests · Terraform and environments.

Built but **unverified on devices**: M5 (two phones, live audio, chat under 200ms, an API
redeploy with a room live), M6 (a real gift between two accounts, animation under 500ms)
M7 (a real purchase, its frame visible to someone else in a room) and M10 (a check-in, five
minutes watched paying out, a follow's live notification arriving).

Honest read: the foundation is stronger than the budget suggests, the product does
not exist yet, and the things most likely to kill this are people problems —
**host supply and trust & safety** — not engineering.

---

## Track 0 — external lead times, all still at ZERO

Nothing here needs code, everything has weeks of lead time, and each one blocks a
milestone. **Incorporation is the critical path** — DLT, Razorpay KYC and the Play
developer account all queue behind the entity existing.

Incorporation (name now settled) · TRAI DLT or WhatsApp Business verification ·
Google Play developer account · Razorpay + RazorpayX KYC · **CA: TDS section in
writing** · CA: agency commission TDS (likely 194H) · RTC vendor on real pricing ·
gaming-law written opinion · Hive account.

---

## Open decisions

| # | Decision | Owner | Status |
|---|---|---|---|
| 1 | Niche / positioning (audio-first + one regional language recommended) | Founders | OPEN — no longer blocks the name, but still shapes M5 (audio-only vs video rooms) |
| 2 | Equity split + vesting (4yr, 1yr cliff) | Founders | OPEN |
| 3 | ~~App name~~ | Founders | **DECIDED — Dhun**, company Dhunlive Private Limited. Verification pending: MCA, IP India 9/38/41, Play Store listing title. |
| 4 | TDS section — 194J (10%, ₹50K threshold) vs 194-O (1%, ₹5L) | CA | OPEN — get it in writing |
| 5 | ~~RTC vendor~~ | Founder | **DECIDED — LiveKit**, self-hosted. At 10K DAU the managed vendors cost ₹2.7–6.9L/month (20–50% of gross); self-hosted is ₹34–66K. LiveKit is the only one that CAN be self-hosted, and the only one with an official Expo config plugin. Cloud stays available for the beta — same SDK, same code, different URL. |
| 6 | Bootstrap runway vs funding timing | Founders | OPEN |
| 7 | Founder role split (product+tech vs ops+growth+agency) | Founders | OPEN |

---

## Cost and scale reference

MVP build ₹40–80L (4–6 months) · growth spend ₹63–90L over 12 months · monthly fixed at
10K DAU ~₹11L · break-even ~₹28.6L/month · T&S at launch ₹2.4–3.1L/month.

At 10K DAU: MAU ~40,000, payers 4% of MAU = 1,600, gross ~₹13.76L/month. Whale
concentration: 2% of payers drive 35% of revenue.

Launch sequence: closed beta (4 weeks, 30–50 hosts) → soft launch (6 weeks, Play Store,
one region, **Android first**) → public, then iOS, then paid ads. At scale, non-engineering
headcount is 60–70% of total (moderation + support + payout ops).
