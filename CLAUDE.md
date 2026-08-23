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

**Unresolved contradiction:** `app-blueprint-v1.pdf` lists a **lucky wheel** under Phase 1
daily hooks. If it costs coins to spin, it is a paid chance-based game and breaks hard rule
#1. Only acceptable as a *free* daily spin awarding coins (a `free_coin_grant` subtype).
Settle this before anyone builds it.

Store-fee note: Google Play India's alternative billing gives only a 4% reduction. Google
dropped anti-steering worldwide, but a purchase within 24 hours of an in-app link click
still incurs 20%. The web recharge portal must therefore be **independently discoverable**
(SEO, WhatsApp, reseller channels), not driven from inside the app.

---

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
external (Agora / ZEGO / LiveKit — undecided) and never transits the backend.

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

### `backend/` — M1, M2 and M4 complete. 95 tests.

Five migrations, 16 endpoints, three processes' worth of code (API and workers
built; the realtime gateway is M5).

| Area | State |
|---|---|
| **Ledger** | Done and proven. Unbalanced transactions cannot commit (deferred constraint trigger), entries cannot be mutated (trigger + revoked grants in `ops/roles.sql`), balances cannot go negative. 20 parallel gifts against a 16-gift balance land exactly 16. |
| **Auth** | Phone OTP behind a provider interface (`console` in dev, `msg91` blocked on DLT), JWT + rotating refresh with replay detection that revokes the device chain, scoped `role_assignments`. |
| **Wallet / purchases** | Server-driven catalogs, IAP behind a verifier interface (stub in dev), Razorpay signature verification fully implemented, coins→gems conversion. |
| **Workers** | `npm run worker`. Outbox shipper (LISTEN/NOTIFY + 2s poll floor), nightly reconciliation at 03:00 IST with 7 checks and zero tolerance, five retention purges. Advisory-lock job locking. |
| **Security** | Rate limiting by IP/device/user, security headers, CORS allowlist, 18+ gate on every money endpoint, strict validation of body/query/params, sanitised client errors. |

**Two invariants worth never breaking:** the ledger idempotency key for a purchase
derives from the **receipt** (`provider:provider_txn_id`), not the client header —
keying off the header let a replayed receipt credit twice. And **`points = coins ×
payout_rate`**, no ×2; a point is worth half a coin, which is what turns an
advertised 60% into a real 30%.

### `mobile/` — foundation complete, zero screens built.

Expo SDK 57 · React Native 0.86 · React 19.2 · expo-router. EAS project
`@sumitsumit/dhun` (`c7c547aa-86e2-4d02-befa-b5e643fde400`). 27 tests.

Read **`mobile/ARCHITECTURE.md`** before adding a file. The essentials:

- **Layering:** `app/` composes → `features/` holds logic → `ui/` `visuals/` present
  → `theme/` `lib/` `api/` `config/` underneath. Never upward.
- **Colour has one source, enforced by lint.** `theme/primitives.ts` (raw, never
  imported by components) → `theme/colors.ts` (semantic, the only colour import).
  A hex literal outside `theme/` is a lint **error**. Currency and gift-tier
  colours are reserved.
- **Every string goes through `t()`**, in both `en.ts` and `hi.ts`. Typed keys, so
  a typo is a compile error. Never concatenate fragments — Hindi is SOV.
- **Money:** branded `Coins`/`Gems`/`Points`/`Paise` types; Indian lakh grouping
  (`1,64,945`, not `164,945`).
- 21 routes exist and are navigable; unbuilt ones render a placeholder naming
  their milestone. Guards use `Stack.Protected`, never redirect effects.

**Gift animations are Lottie**, decided by checking what is maintained: both SVGA
React Native bindings died in 2022 and PAG has no RN binding, because every app
using those formats is native Android/iOS. Brief designers for After Effects →
Bodymovin, 750×750, under 500KB, **and always keep the `.aep` source** — that is
what keeps the decision reversible.

The gift queue **sheds the cheapest gift when full**, never the newest. Dropping a
₹15,000 Galaxy behind two hundred Roses is a refund request.

### Not built yet

Rooms · realtime gateway · RTC (vendor undecided) · chat · gifting UI · feed and
discovery · host tools · **moderation** · analytics pipeline · CI beyond typecheck
and tests · Terraform and environments · every app screen.

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
| 5 | RTC vendor — Agora vs ZEGO vs LiveKit, on real pricing | Founder | OPEN — blocks M5. LiveKit has an official Expo config plugin; the other two do not. |
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
