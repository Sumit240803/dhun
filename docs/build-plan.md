# Build plan — Phase 0 (MVP)

**This document governs the work.** Do not start a milestone whose dependencies are unmet,
do not jump ahead, and do not quietly widen scope. A scope change is an edit to this file,
agreed first — not something that happens inside a coding session.

Target: closed beta with 30–50 hosts and ~500 users. Roughly 4–5 months solo, faster once
the backend hire lands.

---

## Track 0 — External lead times (START NOW, blocks later milestones)

None of these need code. All of them have multi-week lead times and will stall a milestone
if left late.

| Item | Blocks | Notes |
|---|---|---|
| **TRAI DLT registration** for transactional SMS | M2 (auth) | Registered sender ID + per-template approval. Weeks. **The single longest lead time in the project** and it appears in none of the source docs. Provider: MSG91 (India-native, handles DLT). |
| **Google Play developer account** + app listing draft | M4, launch | Content rating, data safety form, 18+, privacy policy URL |
| **Razorpay (collect) + RazorpayX (payout) accounts** | M4, M8 | KYC takes time; payout accounts take longer than collection |
| **CA: TDS section decision** — 194J vs 194-O, in writing | M8 | Open decision #4. Also: coin float as liability, revenue recognised on spend |
| **CA: agency commission TDS** (likely 194H @ 5%) | M8 | Not covered in the source docs |
| **RTC vendor decision** on real pricing | M5 | Open decision #5. Agora vs ZEGO vs LiveKit |
| **Tech lawyer: gaming law written opinion** | pre-launch | At product spec freeze. ₹1–2L. Needed for Play appeals and investor diligence |
| **Hive (moderation) account** | M9 | |
| **App name decision** | Play listing | Open decision #3 |

---

## Milestones

Each milestone is a **vertical slice** — backend and app together — per the modular-monolith
README. Do not build all backend then all UI.

### M1 · Foundation (backend only) — ✅ COMPLETE

Local PostgreSQL 17 service (not Docker — it was already installed; `docker-compose.yml`
is kept as an alternative). Migration runner: pure SQL, checksummed, refuses to re-run an
edited migration, `--reset` for a clean rebuild.

Migrations `001_identity.sql` and `002_ledger.sql` applied and verified: 14 tables,
38 transaction types, 21 system accounts, 20 roles.

Ledger service rebuilt on the real schema — account auto-provisioning, ascending-id
locking, balance cache, transaction-level idempotency, transactional outbox. Five pure
leg-builders (`purchaseLegs`, `giftLegs`, `cosmeticPurchaseLegs`, `conversionLegs`,
`freeCoinGrantLegs`) mirroring the worked examples in `ledger-decisions.md § A4`.

API plumbing: `/v1/` prefix, single error envelope, `trace_id` via `AsyncLocalStorage`,
structured JSON logs, `Idempotency-Key` middleware, liveness and readiness probes,
graceful shutdown.

Postman collection and environment created, with folders mapped to the milestones below.

**Exit criteria — all met (17 tests passing):**
- entries always sum to zero per unit, across all five flows ✓
- 20 parallel gifts against a 16-gift balance → exactly 16 succeed, no drift ✓
- replay returns the original response; reused key with a different identity is rejected ✓
- balance cache always equals `SUM(entries)` ✓
- an unbalanced transaction cannot commit; ledger rows cannot be updated or deleted ✓
- kill switch blocks a deactivated transaction type ✓

**Deferred out of M1:** partitioning `ledger_entries` (own migration before soft launch —
PostgreSQL restricts constraint triggers on partitioned tables, and the balanced-transaction
guarantee matters more at beta volume). Kysely is installed for later CRUD modules; the
ledger uses raw SQL deliberately.

### M2 · Auth spine — BACKEND COMPLETE, app outstanding

**Backend done** (23 tests): guest sessions as real rows · OTP request/verify with per-phone
rate limiting, attempt counting and supersession · JWT access + rotating refresh with replay
detection · device binding · guest → registered upgrade in place · scoped `role_assignments`
with one `hasRole()` everything routes through · 18+ gate on profile.

Endpoints: `POST /v1/auth/guest` · `/otp/request` · `/otp/verify` · `/refresh` · `/logout` ·
`GET /v1/auth/me` · `PATCH /v1/auth/profile`. All seven in the Postman collection, wired so
the flow runs end to end without copying tokens by hand.

OTP delivery is behind an `OtpProvider` interface. `console` logs the code (development);
`msg91` throws until DLT registration completes — deliberately loud, because an auth flow
that appears to work but delivers nothing is worse than one that fails.

**App built** (55 mobile tests): phone entry → OTP → profile setup → tabs, plus the
guest path and the Me screen that upgrades a guest, switches language and signs out.
Every call wired to the real endpoint, every failure mapped through `lib/errors.ts`.

`(auth)` is gated on `!isRegistered` rather than `!isAuthenticated`, because a guest is
authenticated and would otherwise be locked out of the screen that upgrades them.
`profile-setup` moved to `(app)` for the mirror reason — it runs after verification.

**Still outstanding for M2 to close:**
- MSG91 implementation (blocked on Track 0 DLT registration). `devCode` carries the
  flow until then, and the OTP screen surfaces it in development builds.
- **Exit criterion unmet:** a real user signing up on a real device and staying signed
  in across restarts. Needs the development build — no APK has been produced yet.

### M4 · Wallet & purchase — BACKEND COMPLETE, app outstanding

**Backend done** (22 tests, 62 total). Migration `003_economy_config.sql`.

Server-driven config, all seeded: `coin_packs` (6, at 55 coins/₹) · `gift_catalog`
(20 gifts, repriced, incl. the new Scooter bridge) · `cosmetics` (10, VIP seeded inactive) ·
`level_thresholds` · `app_config` (7 dials). Adding a gift or changing a price is now an
`UPDATE`, never an app release.

Purchases: IAP behind an `IapVerifier` interface (stub for dev, Google Play blocked on the
M3 spike) · Razorpay web signature verification, **fully implemented** since it is verifiable
offline · `purchases` with `UNIQUE (provider, provider_txn_id)` · starter pack lifetime-once ·
per-channel cash accounts so channel mix is a balance read.

Coins → Gems conversion at +20%, one way, rate read from `app_config`.

Wallet: balances, packs, transaction history (scoped to the caller's own accounts),
purchase history. User level accrues on purchase, not spend.

Endpoints: `GET /v1/catalog/gifts|cosmetics` · `GET /v1/wallet`, `/packs`, `/transactions`,
`/purchases` · `POST /v1/wallet/purchase/iap`, `/purchase/web`, `/convert`. All in Postman.

**Key design correction found by test:** the ledger idempotency key for a purchase is derived
from the **receipt** (`provider:provider_txn_id`), not from the client's `Idempotency-Key`
header. Keying off the header let a replayed receipt with a fresh key create a second ledger
transaction and credit coins twice — the `purchases` UNIQUE constraint blocked the duplicate
row while the money still moved. One receipt, one credit, forever.

**Still outstanding for M4 to close:**
- App: wallet screen, pack list, purchase flow, two visible balances.
- Real Google Play verifier (M3 spike).
- **Exit criterion unmet:** a real ₹19 purchase on a real device.

### Cross-cutting · Security hardening + workers process — ✅ DONE

Not a milestone of its own; pulled forward because both get harder to retrofit once a client
depends on the API's shape.

**Security** (20 tests): real rate limiting per IP / device / user with failures-only counting
on auth · security headers · CORS allowlist · `trust proxy` · 18+ gate enforced on every money
endpoint (`requireAdult`) · `ops/roles.sql` making the ledger append-only by grant as well as
by trigger.

**Error handling**: every failure mapped — malformed JSON, oversized body, wrong content type,
Postgres constraint violations, deadlocks, serialisation failures, query timeouts, lost
connections, client disconnects. Process-level `uncaughtException` / `unhandledRejection`.
DB `statement_timeout` and `idle_in_transaction_session_timeout`.

**Sanitised messages**: `expose` flag on `AppError` — 5xx keeps its descriptive message in the
LOGS and sends a generic one to the client. Zod issues no longer echo caller input back.

**Validation**: body, query and params, all `.strict()` so unknown keys are rejected rather
than silently stripped. Prototype-pollution keys blocked. Bounds at both ends on every number.

**Workers** (13 tests): `npm run worker`. Outbox shipper (LISTEN/NOTIFY + 2s poll floor,
`FOR UPDATE SKIP LOCKED`, per-partition ordering, attempt counting, poison-message alerting) ·
nightly reconciliation at 03:00 IST with **7 checks**, zero tolerance, paging on mismatch,
results stored per check per day so the beta exit criterion is one query · five retention
purges · advisory-lock job locking · `job_runs` history.

### M3 · Spikes (throwaway, de-risking) — MOVED, runs immediately before M5

**Re-sequenced by agreement.** Both spikes need a client on real devices, and there is no
`mobile/` yet, so neither could run in its original slot. They now sit where they actually
de-risk: right before M5 (rooms/RTC), by which point the app exists.

Two proofs before committing architecture. Both are disposable code.

1. **RTC spike** — two devices, live audio, through the chosen vendor's token flow
2. **Play Billing spike** — a real ₹19 purchase, server-side receipt verification

**Cost of moving it:** M4 builds its purchase path against an *assumed* Play Billing shape.
Low risk — receipt verification is a stable, well-documented API and sits behind one
interface — but it is a real trade, taken knowingly.

**Exit:** both work end to end. Findings written down. Code deleted.

### M5 pre-work · The read side, done early — ✅ DONE

Pulled forward from M5 by agreement, because the app had nothing real to show and
none of it depends on the RTC vendor. Migration `006_social` plus 18 tests:

- `GET /v1/rooms/feed` — explore / party / following, ordered by viewers, trending
  computed in the same query. Readable WITHOUT a session, because browsing is the
  top of the funnel.
- `GET /v1/messages/threads` — unread from a read watermark, not a counter.
- `GET /v1/users/me/summary` — follows, mutual-follow friends, unseen visitors,
  level, points from the ledger.
- `GET /v1/config/banners` — server-driven, killable by a flag, `action` a closed set.
- `npm run seed` — 11 hosts with live rooms, 3 banners; `--user=<uuid>` adds
  follows, official threads and visitors. Refuses to run in production.

**Still M5:** joining a room, seats, presence, chat send, and the realtime gateway.
All of those need open decision #5 settled.

### M5 · Rooms, realtime & chat (backend + app)

Realtime gateway as its **own process**. WS protocol, auth handshake, presence and seat maps
in Redis, cross-instance fanout via Redis pub/sub. RTC behind a vendor interface.

`rooms`, `room_sessions` (go-live start/end — this feeds host hours and the seeding
guarantee). Text chat, emoji, mic request queue. Text filter with Hindi/Hinglish
transliteration.

App: live feed, room view, go-live, seat UI, chat.

**Depends on:** RTC vendor decided.
**Exit:** two devices in one room with working audio · accurate presence · chat delivered
under 200ms · the API can be redeployed without dropping live rooms.

### M6 · Gifting (backend + app)

Gift catalog served from config. `sendGift` on the real ledger — 8 legs, one transaction.
Combo multipliers as a single transaction with quantity. Room leaderboard as an event
subscriber. Fast-path fanout so animations don't wait on the outbox.

App: gift sheet, combo tap, animations, room leaderboard.

**Exit:** gift sends · host points credit at exactly `coins × payout_rate` · animation
appears in under 500ms · ledger balances · payout ratio measured at 30% on gifting.

### M7 · Cosmetics (backend + app) — *moved from Phase 1*

**Scope change, deliberate:** gems are 19–37% of every coin pack, so without cosmetics they
buy nothing and the margin design does not exist.

Ships: profile frame, chat bubble, nickname colour, basic entry effect. `user_cosmetics`
with expiry. VIP tiers stay in Phase 1.

**Exit:** gems spend · cosmetics expire correctly · cosmetics share of spend is measurable.

### M8 · Host tools & payouts (backend + app)

Host verification: PAN capture and validation, bank penny drop, face match, age from PAN
DOB. One PAN = one host. 14-day bank-change cooling period.

Hold period (7/14 days), withdrawal request with limits, maker-checker approval, weekly
batch, provider integration. TDS behind a strategy interface. `tds_yearly_totals` per host
per financial year. `host_guarantees` for the ₹15,000/month seeding.

App: earnings dashboard, withdrawal flow.

**Depends on:** CA decision, RazorpayX account.
**Exit:** first real payout batch reconciles to the rupee · maker-checker cannot be
bypassed by one person · TDS threshold crossing applies to the full amount.

### M9 · Trust & safety (backend + app)

18+ gate at signup. Report and block flows. Hive integration — video frames and text
minimum, audio deferred. Trust-based sampling (new hosts 1s, trusted 10s). Confidence
routing (>0.9 auto-kill, 0.6–0.9 human queue, <0.6 log). Moderator dashboard with grid view
and one-click actions. Enforcement action log. Appeal form with a *different* reviewer.
Evidence preservation in restricted storage.

**Exit:** L1 detection to action under 30 seconds, verified by drill · appeal reaches a
second reviewer · Grievance Officer contact published in-app and on web.

### M10 · Discovery & daily hooks (backend + app)

Live feed, category tabs, following tab, search. Follow + live notification. Daily check-in
with streak, watch reward, push notifications. Referral with `free_coin_grant`.

Cold-start handling from the growth plan: consolidate rooms (show 4, not 10), enforce peak
hours, hide absolute viewer counts, drop new users into the fullest room.

**Exit:** the Phase 0 feature list is complete.

### M11 · Beta hardening

Daily reconciliation job with pager alert. Per-feature kill switches (the `is_active` flag
on transaction types covers the money layer). Force-update. Crash monitoring. On-call
rotation documented. Rollback plan. Privacy policy, ToS, community guidelines live.

**Exit:** the closed-beta entry checklist from `data-and-launch-plan-v1` is fully green.

---

## Admin panel — threaded, not a milestone

Your docs are explicit: *"Admin panel MVP ka hissa hai, baad mein nahi."* Each milestone
ships its own admin screens — catalog editing in M4, room monitoring in M5, payout approval
in M8, the moderator dashboard in M9. There is no separate admin phase.

---

## Explicitly OUT of Phase 0

Do not build these, however small they look:

PK battle · video party rooms · private 1-on-1 calls · multi-guest live · live quiz ·
karaoke · polls · VIP tiers · fan club · fan levels · DM · friend list · agency dashboard ·
sub-agent tooling · reseller wallet · trending/nearby/auto-preview · daily tasks · weekly
events · A/B testing framework · short video · recommendation feed · paid-entry rooms ·
guardian slots · CP pairing · family/guild · stealth mode

**Never build:** lucky gifts · mystery boxes · any paid chance-based game · user-to-user
currency transfer · a lucky wheel that costs coins to spin.

---

## Rules of engagement

1. **Milestones are sequential.** M(n) does not start until M(n−1) exits.
2. **Exit criteria are binary.** No "mostly working."
3. **Vertical slices.** Backend and app for a feature ship together.
4. **Postman is updated in the same change as any endpoint.** Stale collection = broken build.
5. **Ledger changes go through `backend/docs/ledger-decisions.md` first.** No schema change
   to money tables without the checklist item resolved.
6. **Scope changes edit this file**, agreed before the work — never mid-session.
