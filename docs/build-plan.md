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

### M2 · Auth spine — COMPLETE except OAuth and the dev build

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

**Added since** (213 backend / 68 mobile tests total):

- **Email + password**, with confirmation deliberately DEFERRABLE — the account works
  immediately and what verification gates is money, not access. Migration `010`.
- **MSG91 OTP widget** (`011`), where MSG91 sends and checks the code client-side and the
  server confirms the returned access token with the account authkey. Our own OTP path
  stays as the fallback, so an MSG91 outage degrades signup rather than stopping it.
- **Password reset and change**, **session list and per-device revocation**, **account
  deletion** (anonymises — the ledger is append-only), and **phone-number change** (`012`,
  which also gave `otp_challenges` a `purpose`).

**Still outstanding for M2 to close:**
- **OAuth** — Google, Facebook, Instagram. The buttons exist on the sign-in screen and
  are the only auth surface with nothing behind them.
- MSG91 delivery is still blocked on Track 0 DLT registration. `devCode` carries the flow
  until then, and the OTP screen surfaces it in development builds. The widget's
  `/verifyAccessToken` leaf is unconfirmed — it fails CLOSED, so a wrong shape means
  nobody signs in through the widget rather than anyone signing in as anyone.
- **Exit criterion unmet:** a real user signing up on a real device and staying signed
  in across restarts. Needs the development build — no APK has been produced yet, and
  the widget's native module cannot run without one.

### M4 · Wallet & purchase — BACKEND COMPLETE, app outstanding

**Backend done** (22 tests, 62 total). Migration `003_economy_config.sql`.

Server-driven config, all seeded: `coin_packs` (6, at 110 coins/₹ after 018) · `gift_catalog`
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

Follow-up pass closed every column that had a read path and no write path —
`follows`, `thread_participants.last_read_at`, `profile_visits.seen_at` — plus
`GET /v1/config/app`, which finally feeds the `applyRemoteFlags()` that had been
sitting unused in the client since the foundation (day-1 non-negotiable #5).
16 more tests. App screens: Visitors, and a thread that marks itself read.

**Still M5:** joining a room, seats, presence, chat send, and the realtime gateway.
All of those need open decision #5 settled.

### M5 · Rooms, realtime & chat (backend + app) — BUILT, UNVERIFIED

**Open decision #5 settled: LiveKit, self-hosted.** The managed vendors cost 20–50% of
gross revenue at 10K DAU against ₹34–66K self-hosted, LiveKit is the only one that *can*
be self-hosted, and the only one with an official Expo config plugin.

**Built** (migration `013_room_seats.sql`, 30 tests): go live · join · mic seats · host
mute and kick · end room · LiveKit webhooks. Everything vendor-shaped is behind an
`RtcProvider` interface in `modules/realtime/`, so the decision stays reversible.

The authorisation boundary, stated once: **Postgres decides who may do something; LiveKit
enforces what they can do once connected.** Publish rights come from the seat table and
there is no way to request them.

Three things worth carrying forward:

- **An omitted LiveKit grant is a granted one.** `canPublish` left out means publish is
  enabled. Every grant is explicit, including the `false` ones.
- **Presence is NOT mirrored into Postgres.** It would drift from the media server within
  seconds of the first dropped connection and the two would disagree in front of a user.
  Seats, bans and sessions are ours; who is connected is LiveKit's.
- **A host disconnecting is not the room ending.** `room_sessions` records each unbroken
  stretch the host was actually live, so a tunnel does not scatter the audience and does
  not get paid as host hours either.

**The gateway is built too** (`014_room_chat.sql`, 33 tests). Third process,
`npm run gateway`: WS protocol with an auth handshake, chat, the mic-request queue,
pushed seat maps, presence, and cross-instance fanout over Redis. The app side is
complete — feed, room view, go-live, seat UI and chat — and the 3-second seat poll it
replaced is deleted.

**A deliberate divergence from what this file said.** It specified "presence and seat
maps in Redis". Seats went to **Postgres** instead: a contested seat needs a transaction
and a uniqueness constraint, and that is what makes two people tapping at once resolve
to exactly one winner. Redis cannot do that, and a seat map that occasionally seats two
people is worse than a slower one. Presence stays in process memory, with Redis only as
the pub/sub bus between instances.

**Seats are requested, not grabbed.** With eight seats and two hundred listeners an open
grab is won by whoever taps fastest, and the host has no say in who speaks in their own
room. Tapping an empty seat raises a hand; the host approves from a queue only they see.

**Exit — none of it verified yet:** two devices in one room with working audio (one
publisher has been proved, not two) · accurate presence · chat delivered under 200ms ·
the API redeployed without dropping live rooms. That last one is the payoff for the
process split and should be tested deliberately: restart the API with two phones in a
room and check audio and chat both survive.

**Still M5:** nothing but that verification.

**Deployment note:** this is now THREE processes, not two. The gateway is the one that
cannot be rolled without dropping sockets — clients reconnect with backoff, but a deploy
during peak hours is felt.

### M6 · Gifting (backend + app) — BUILT, UNVERIFIED

**Scope change, agreed 2026-09-16:** M6 started while M5's exit verification (two devices,
live audio) is still outstanding. That verification needs two phones and is the founder's to
run; nothing in M6 depends on its result, and waiting would have idled the build.

**Ledger decisions settled first** (`backend/docs/ledger-decisions.md`): C10 one transaction
per combo, G1 rates and unit price frozen on the send, G2 the kill switch is read inside the
posting transaction.

**Built** (migration `015_gifting.sql`, 27 tests): `POST /v1/gifts/send` on the real ledger —
the 8 legs from `giftLegs`, one transaction whatever the combo, `Idempotency-Key` required,
registered 18+ only. The recipient is the host or anyone on a seat; gifting yourself, a
recipient off stage, a recipient who blocked you, an ended room and a room ban are all
refused. The client sends the price it displayed and a repriced gift is refused, never
charged. A retry replays the original even after the room ends. Fast path: published to the
room the moment the ledger commits. `GET /v1/gifts/leaderboard/{roomId}`.

**A deliberate divergence from what this file said.** It specified the room leaderboard "as
an event subscriber". It is a query over **`gift_sends`** instead — one row per gift, written
by a hook INSIDE the ledger's own posting transaction. An outbox subscriber would be
eventually consistent with the money; this cannot disagree with it, and a new reconciliation
check (`gift_sends_match_ledger`) proves that nightly. The platform-wide daily boards, which
are too big to aggregate per request, stay sorted-set subscribers and move to M10.

**Asset contract gaps closed** (`docs/asset-contract.md` § 10): `icon_asset` on the catalog,
versioned `placeholder/` paths, Tier 1–2 animation paths removed (with a CHECK constraint),
and a production-only reconciliation check that refuses stand-in art.

App: gift sheet (recipient, tiers, grid, combo multipliers, total beside the balance, top-up
when short), one-tap send with an "again" combo button, idempotency keys reused only to retry
a send whose outcome is unknown, the full-screen animation layer mounted, the sender's own
gift shown from the response before the socket echo, gift buttons in the seat bar and the
chat composer, a top-gifters sheet, and the `giftingEnabled` flag hiding all of it.

**Not in M6, deliberately:**
- **Tier 5 "all-rooms" broadcast.** Global gifts currently play in their own room only. It
  needs a global gateway channel and a design for how another room's gift appears; it is small,
  but it is a product decision first.
- **Stand-in art files.** The catalog points at `placeholder/` paths that are not uploaded
  anywhere yet, so the app draws its fallbacks — a tier-tinted gift glyph and a text card.

**Exit — none of it verified yet:** gift sends · host points credit at exactly
`coins × payout_rate` (asserted in tests, not yet on a device) · animation appears in under
500ms · ledger balances · payout ratio measured at 30% on gifting.

### M7 · Cosmetics (backend + app) — BUILT, UNVERIFIED — *moved from Phase 1*

**Scope change, deliberate:** gems are 19–37% of every coin pack, so without cosmetics they
buy nothing and the margin design does not exist.

**Ledger decisions settled first** (`backend/docs/ledger-decisions.md`): C11c, time stacks
onto an active item and restarts after expiry; C11d, ownership written inside the ledger's
own transaction and expiry evaluated on read, never swept.

**Built** (migration `016_cosmetics.sql`, 25 tests): the four kinds — avatar frame, chat
bubble, nickname colour, entry effect — three frames, three bubbles, three name colours and
two entrances, each kind at its source-doc price. `POST /v1/cosmetics/purchase` spends
**gems only** (never coins, whatever the coin balance), money-endpoint gates, replay-first
like gifting, and refuses a key reused by another account. Buying equips; one item per kind
is worn, enforced by a unique index. `GET /v1/cosmetics/mine`, `POST /equip`, `POST /unequip`.
The catalog carries art paths, validated light/dark style data, and the live coins→gems
terms.

**What people see:** a `look` travels with every person the backend describes — room seats,
chat lines, gift senders, public profiles, the owner's own summary — batched into one query
per seat map or chat backlog and cached for 15 seconds per process. Someone wearing an entry
effect is announced to a room over the gateway, at most once per room per five minutes, so a
reconnecting phone does not replay it at every doorway.

**Exit criterion "share is measurable":** a daily `spend_mix` worker job at 03:30 IST
records gifting vs cosmetics revenue for the previous IST day in `job_runs.result`, read
straight off `revenue_gifting` and `revenue_cosmetics`. A new reconciliation check,
`cosmetic_purchases_match_ledger`, holds each purchase record to the gems that moved.

App: a Store (from the Me tab) built around a live preview of the viewer wearing the
selected item over what they already wear; shelves per kind with status (wearing / owned /
expired, days left); a confirmation sheet that says exactly how many days a purchase adds;
wear, take off, extend and renew; a coins→gems sheet that states it is one way and suggests
exactly enough to cover a shortfall. Frames on seats, gift strips, the Me tab and profiles;
bubbles and name colours in room chat; an entry banner in rooms. Every cosmetic has a
code-drawn fallback, so nothing paid for is invisible while stand-in art is missing.

**Not in M7, deliberately:**
- **Free unlocks by user level** (`free_at_user_level`, `cosmetic_grant`). Levels are not
  visible anywhere in the app yet, and a reward nobody can see coming is not a reward.
- **Super messages and VIP tiers.** Hidden in the catalog; VIP remains Phase 1.
- **Gradient nickname colours.** Solid colours until masked text ships.

**Exit — none of it verified on a device yet:** gems spend · cosmetics expire correctly
(tested server-side, including extension and renewal) · cosmetics share of spend is
measurable (the job exists; it needs real traffic to mean anything).

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

### M10 · Discovery & daily hooks (backend + app) — BUILT, UNVERIFIED

**Re-sequenced by agreement, 2026-09-16:** M10 is built before M8 and M9. M8's core is blocked
on the CA's TDS decision and a RazorpayX account, M9's detection core on a Hive account, and
nothing in M10 depends on either. M8 and M9 are NOT skipped — the Phase 0 exit still needs
both.

Live feed, category tabs, following tab, search. Follow + live notification. Daily check-in
with streak, watch reward, push notifications. Referral with `free_coin_grant`.

Cold-start handling from the growth plan: consolidate rooms (show 4, not 10), enforce peak
hours, hide absolute viewer counts, drop new users into the fullest room.

**Decisions settled first** (`backend/docs/ledger-decisions.md` § C5b, C5c): free-coin amounts
and caps from economy-design-v1 § 6 in `app_config.free_coins`; the check-in ladder the doc
gives only as 20 → 150 fixed at 20, 30, 40, 60, 80, 100, 150; ledger keys derived from the
claim, never a client header; referral paid only on a first purchase of at least ₹99.

**Built** (migration `017_discovery_rewards.sql`, 36 tests):

- **Free coins**, all ordinary giftable coins, all once-only by construction (a
  `reward_claims` row per credit, keyed like the ledger txn), all per IST day, all behind the
  `free_coin_grant` kill switch: the **welcome bonus** (500, once per account and per
  device), the **daily check-in** (7-day ladder, wraps, resets on a missed day), the **watch
  reward** (30 per 5 minutes, 10 a day — measured by the GATEWAY, which alone knows a socket
  sat in a room; the host is never paid for their own room, and a stalled process cannot pay a
  whole interval on waking), and **referrals** (2,000 on the friend's first ₹99+ purchase,
  paid by the workers' outbox consumer; entered within 7 days, never your own, never across a
  shared phone).
- **Push**: Expo push tokens behind a provider interface (console in development), cleared on
  sign-out and moved to whoever signs in on a phone last. The **followed-host-is-live**
  notification is driven by a `room_started` outbox event written in the same transaction as
  the room: once per follower per room, once per host per 2-hour cooldown, 5 a day, never
  across a block, never for a room already over, written in the follower's language (the
  profile now carries `locale`, synced from the app).
- **Search**: people by name prefix or exact public ID, live rooms by title or host;
  blocks hide both ways.
- **Cold start** (`app_config.cold_start`): the feed shows the fullest 4 rooms (Following is
  exempt), viewer counts are hidden, an empty feed outside 8–11 PM IST says when rooms fill
  up, and a new user lands in the fullest room straight after profile setup.
- **Workers consumers**: the outbox now drives consequences as well as analytics, at least
  once, each consumer idempotent on its own key.

App: the Discover tab (search as you type, a live person opens into their room), a Daily
rewards screen (welcome, check-in ladder, watch progress, invite code with share and code
entry), a once-a-day check-in prompt, a rewards row on Me with a dot when something is
waiting, the "+30 coins for watching" notice in rooms, the push permission asked right after
a follow, notification taps opening the room, hidden counts on cards and the room header,
and the peak-hours empty state.

**Interpretation recorded:** "enforce peak hours" is built as TELLING users when rooms are
full, not as refusing to let hosts go live outside the slot. Refusing a host who wants to
broadcast would cost supply, which the growth plan names as the real risk. Concentrating
hosts into the slot remains an operational job for host seeding.

**Not in M10, deliberately:**
- **Follow and share rewards** (economy doc § 6): not in this milestone's list, and a share
  cannot be verified.
- **The D0 "2 hours later: Priya is live" push** and the host's "Welcome Rahul!" signal:
  growth ideas, not build-plan items.
- **Push delivery on Android** needs Firebase credentials uploaded to the Expo project and a
  development build that includes them. Until then registration fails quietly and is reported.

**Exit — not met yet:** the Phase 0 feature list is complete only once M8 (payouts) and M9
(trust & safety) are built, and M5–M7 and M10 are verified on devices.

### M11 · Beta hardening

Daily reconciliation job with pager alert. Per-feature kill switches (the `is_active` flag
on transaction types covers the money layer). Force-update. Crash monitoring. On-call
rotation documented. Rollback plan. Privacy policy, ToS, community guidelines live.

**Exit:** the closed-beta entry checklist from `data-and-launch-plan-v1` is fully green.

---

### Redenomination ×2 — DONE, 2026-09-27

Migration `018_redenomination.sql`. Every coin, gem and point count doubled — packs, gifts,
cosmetics, level bands, free-coin grants, and the three rates (110 coins/₹, 130 units/₹ face,
260 points/₹). **No rupee price moved and no ratio changed**, because both sides of
`coins per ₹ ÷ 433.4` doubled together; a gift pays the same host the same rupees as before.

It ran before M12 deliberately: M12 quotes prices to agencies, wholesale rates, level bands
and commission figures, and renumbering after those exist would mean changing them twice.

**Exit, met:** 360 backend tests and 114 mobile tests pass on the new denomination, Postman
examples updated, `npm run check` clean. Balances are NOT rescaled by it — the ledger is
append-only — so this migration is pre-launch-only, which the file says at the top.

---

### M12 · Agency & reseller network (backend + app + admin)

**Scope change, agreed 2026-09-25.** Moved into Phase 0 from Phase 1 ("agency dashboard ·
sub-agent tooling · reseller wallet" were explicitly OUT), and built before M8, M9 and M11.
The reason is the revenue model: at a ₹10,000 minimum, direct top-up is how AGENCIES buy
inventory, not how users buy coins. Without agencies there is no retail channel for a user
who will not pay ₹10,000 — which is almost all of them.

**The flow** (ledger-decisions § C3/C4; CLAUDE.md "Coin distribution channels"):

1. **An admin creates the agency — never the app** (founder, 2026-09-28). Registration is an
   email to the official address, a conversation, then manual onboarding and verification
   (PAN, bank account, GST where applicable). There is no application table and no approval
   queue: the `agencies` row IS the approval. A main agency cannot be created in-app.
2. It pays the platform up front and receives coins into an **inventory account it cannot
   gift from**. Never on credit — the non-negative balance is what enforces that.
3. **It finds its own customers, entirely off the app** (scope change, founder,
   2026-10-05). There is no agency list in the app, no rate card and no in-app way to
   contact an agency. An agency reaches people through WhatsApp, its own channels and word
   of mouth, and sets its own price there.
4. The user pays the agency **off-platform** and gives them their User ID. No platform money
   is involved on this leg, and no escrow — escrow is what would make us a payment
   aggregator.
5. The agency transfers coins from inventory to the user's account. The user gets the coins
   and a receipt; both sides keep a permanent record.

**Why there is no directory.** Two reasons, and the first is the expensive one. A purchase
within 24 hours of an in-app link click still incurs Google Play's 20% fee even now
anti-steering is gone worldwide, and a priced in-app list of ways to buy coins outside Play
billing is the clearest trigger for it — the same reason CLAUDE.md requires the web recharge
portal to be independently discoverable rather than driven from inside the app. Second, a
public directory of people soliciting off-platform payment is a moderation surface we would
have to staff from launch. Migration 022 drops the `agency_listings` table.

**How a host joins** (founder, 2026-09-28). Two routes, both needing consent from both sides:

- the host types an **Agent ID** and the agent accepts — an agency invite link is this route
  with the ID pre-filled;
- the agent enters the host's **User ID + Host Code** and the host accepts.

The Host Code exists because user public IDs are sequential 8-digit numbers: without a second
factor an agent could invite every user on the platform by typing numbers in order. The host
can rotate it, which revokes every copy handed out.

**Commission levels D/C/B/A/S at 4/8/12/16/20%** (founder, 2026-09-28). **Everyone earns
points and withdraws directly** — host from $10, agency and sub-agent from $20, in $10
steps. Points→coins exchange at **parity** (value-neutral, no bonus) to launch.

**Membership rules** (founder, 2026-10-05; migration 020, ledger-decisions § M12 membership):

- **Quitting** follows the competitor flow: an undecided application lets the host go after
  7 days; a host who never attempted face auth, or joined under a day ago, leaves at once;
  one application per 30 days whatever the outcome; a rejection can still be approved for 14
  days. **Only the agency owner decides. The platform plays no part in a host leaving.**
- **One in-house agency** ("Dhun Official"), created by an admin like any other, holds the
  30–50 hosts we seed ourselves. It earns no commission; its hosts move to a real agency
  through the ordinary quit and join flow.
- **60% stays the base gift split.** "Up to 70%" is used only for top performers or events,
  so the claim is true without moving the base payout.
- **New agencies start on lower transfer caps** for 30 days.
- **A bad agency** (a user paid and got no coins): a published policy, a report button and
  suspension. Any refund from us is goodwill, never a promise — we hold no escrow, by design.

**Built 2026-10-05 — membership slice:** admin agency creation, both join routes, the Host
Code, the full quit flow with owner decisions and the auto-leave sweep (backend, Postman,
tests), and the app's My Agency screen for host, agent and owner.

**Built 2026-10-05 — coin channel:** the coin-trading grant; prepay under maker-checker
(the database refuses the admin who recorded it) minting into `agency:{id}:inventory` at the
124/132/140 wholesale tiers; agency→user transfer with per-transfer, per-recipient and
per-agency IST-daily caps, reduced for an agency's first 30 days; the append-only transfer
log read from both ends; migration 021 switching both txn types live. App: the agency
owner's coin stock, a confirm-then-send transfer sheet, transfers sent, and the user's own
record of coins received. Ledger-decisions § M12 coin channel.

**Exit criteria, all met** (the directory clause was struck by the 2026-10-05 scope change):
an agency prepays and its inventory matches the rupees to the paisa · a transfer moves coins
with no revenue booked and the float still reconciles · an agency cannot transfer coins it
has not bought · every transfer is auditable from both sides.

**Built 2026-10-05 — sub-agents and the back office (migration 023):** an agency manager
invites someone to an agent seat and they accept; the roster with each agent's host count;
removing an agent, which **moves their hosts to the owner** rather than stranding them;
granting and withdrawing agent management. Back office: the agency list with search, one
agency in full (counts, stock, prepay totals, suspension history), suspend/reinstate/close
with a recorded reason, and the transfer audit searchable from either side. App: the roster,
the invite form and the invitation a prospective agent answers.

**Built 2026-10-05 — the commission engine (migration 024):** levels fixed a period in
advance from the previous period's volume, with the one-step floor and the sub-agent cap; the
period close deriving attributions through the dated links and posting one transaction per
payee; the agency/sub-agent differential split; a daily close job that pages on failure. App:
the commission card showing the rate already fixed for this month and the volume setting the
next. Ledger-decisions § M12 commission.

**M12 is complete.** Two things remain that are not features of it:

- **No admin web app** in this repo — it is backend and mobile only — so every back-office
  action is an API call. Standing up an admin panel is its own decision (framework, hosting,
  auth) and is not scoped here.
- **Commission points cannot be withdrawn yet.** They accrue into `_held` and wait for M8's
  hold release and payout pipeline, which is blocked on the CA's TDS decision and a
  RazorpayX account.

**Schema: migration 019** — agencies, agents, the two dated links, host join codes, join
requests, maker-checker prepays, the append-only transfer log and the `agency` config block;
**020** membership and the in-house agency; **021** the coin channel live; **022** drops the
listings table. See ledger-decisions § M12 schema.

**Ships:**
- **Backend:** admin-created agencies; `agency:{id}:inventory` accounts; prepay crediting
  behind maker-checker; agency→user transfer with per-transfer, per-recipient and per-agency
  daily limits and an append-only transfer log; wholesale rate tiers in `app_config`;
  suspension and the coin-trading grant.
- **App, user side:** their own record of coins received, and nothing else. No list, no
  prices, no contact.
- **Agency-side app:** inventory balance, transfer by user public ID, transfer history.
  Gated on the coin-trading grant and the agency owner.
- **Admin (API):** agency creation, the coin-trading grant, prepay confirmation
  (maker-checker), the agency list and detail, suspension with a recorded reason, and the
  transfer audit. No admin UI — see above.

**Deliberately NOT in M12:**
- **Any in-app agency directory, rate card or user↔agency messaging** (founder,
  2026-10-05). See "Why there is no directory" above. The general DM send path stays Phase 1
  as it always was.
- **The commission engine and withdrawals themselves.** 019 seeds their config and point
  accounts; computing commission and paying it out is M8's payout pipeline.
- **Escrow or any user→agency payment rail.** See above; also hard rule #7 stays intact —
  transfer is one-directional, agency inventory → user, never back.
- **Crypto acceptance (USDT/USDC).** Held pending the Track 0 legal opinion; the likely
  outcome is FIU-IND registration and an AML programme under PMLA. Bank transfer, UPI and
  Razorpay cover the same need with none of it.

**Exit:** an agency prepays and its inventory matches the rupees received to the paisa · a
transfer moves coins with no revenue booked and the float still reconciles · an agency cannot
transfer coins it has not bought · a user can find an agency by price, message it, and
receive coins · every transfer is auditable from both sides.

---

### M13 · The room, rebuilt to the references (app) — ✅ UI COMPLETE, PK backend outstanding

**Scope change agreed 2026-10-13**, after the founder supplied 39 screenshots and 4 videos
of a competitor room in `app-reference-images/live-rooms-app-references/` and asked for the
same layouts, with placeholders where art is missing.

**Why it was worth doing before M8.** The room is the product. Ours showed seats *or* chat
behind a segmented tab, so you could watch or talk but not both — every reference shows the
stage above and the chat permanently below, with gifts flowing between them. No amount of
styling fixes a tabbed room, and the fix is layout work needing no new endpoints.

**Shipped:**

- `features/room/model.ts` — a tagged `StageModel` built from room + seats + pk, and
  `stage/Stage.tsx` switching on it exhaustively. Six room types, one set of chrome.
- Stages: **seat grid** (2–20 seats, stepped 2→5 columns), **video** (one or two tiles plus
  a right-edge mic rail for everyone else on audio), **PK** (1v1 and team), **solo audio**.
- Chrome: header with top-gifter rail, activity rail (rank · rules · room code), scrolling
  marquee, chat panel with the vertical All/Room/Chat filter, composer with quick replies.
- Sheets and dialogs: features grid, profile card, and the mic-link flow in **three** states
  — waiting, queued, and the **follow gate** we did not previously have.
- Video: camera publish and flip in `useLiveRoom`, tracks exposed as a context, `RemoteVideo`
  behind the same lazy guard as the rest of LiveKit.
- `roomAssets.ts` — the five pieces of room art still to be drawn, each with its spec and
  `available: false`, with code fallbacks until then.

**Exit criteria met:** typecheck, lint and Prettier clean · 144 mobile tests (24 new) ·
every string in `en.ts` and `hi.ts` · no hex literal outside `theme/` · no image imported.

**Still outstanding, and deliberately not in this milestone:**

| Item | Needs |
|---|---|
| Hourly / popularity rank | A ranking endpoint. `ActivityRail` takes `rank={null}` today. |
| Fan club | In the references, not in this plan. A paid per-host membership — decide before building. |
| Share, minimise | Disabled tiles in the features sheet, labelled "Soon". |
| Device verification | Two phones: a party room at 9 and at 20 seats, a video room with a guest on the rail, chat under 200ms. |

---

### M14 · PK battles, end to end (backend + app) — ✅ COMPLETE, unverified on devices

Built 2026-10-13 immediately after M13, because the PK stage was the one part of the room
with nothing behind it.

**Shipped:** migration 028 (`pk_battles`, `pk_battle_members`, `pk_host_stats`,
`pk_invites`, `pk_queue`, `app_config.pk`) · `modules/games/` with the service, config,
routes and jobs · 10 routes under `/v1/pk` · two worker jobs (`pk_settle` every 5s,
`pk_match` every 10s) · a `gift_sent` outbox consumer that re-pushes the scores ·
`pk:started` / `pk:score` / `pk:ended` on the gateway, to **both** rooms · the app's
`usePk` hook, fetched once on joining and pushed thereafter, never polled.

**Exit criteria met:** 22 backend tests, including a `the money boundary` block that
asserts a whole battle writes **nothing** to the ledger and leaves it balanced · invite,
accept, decline, random queue, forfeit, room-ended, streaks, draws, idempotent settlement
and a two-accept race all covered · Postman folder written · typecheck and lint clean.

**The two rules that keep this legal**, recorded at the code that could break them
(`pk.config.ts`, migration 028's header, `backend/docs/ledger-decisions.md` § PK battles):

1. **PK moves no money.** It is a scoreboard over `gift_sends`; every gift counted was
   already paid to its recipient by `gifting` when it was sent. Pooling the two audiences'
   gifts or refunding the loser turns a purchase into a wager on an uncertain outcome — an
   online money game under the Act, hard rule #1. The winner gets a streak badge.
2. **`winMultiplier` is display-only.** The payout ratio is set by one number, and a
   multiplier reaching the ledger would move it on every battle.

**Outstanding:** team mode has its table (`pk_battle_members`) and its stage, but no route
fills a roster — 1v1 is what ships. Device verification: two phones, a real battle, the bar
moving on both, a result landing within a second of zero.

---

### M15 · Room codes and the hourly board (backend + app) — ✅ COMPLETE, unverified on devices

Built 2026-10-13. Two things the references put on the second line of every room, and the
two the rebuilt chrome had nothing to fill it with.

**`rooms.public_id`** — six digits from 100001, the short number a host reads out. Same
pattern as `users`, `agencies` and `agents`; the rule is migration 006's. `GET
/v1/rooms/code/:code` finds a **live** room by it, because a code nobody can use to reach
the room is decoration.

*The founder asked whether we could move from uuids to 6–8 digit numbers as ids. We did
not,* and the reasoning is in migration 029's header: a sequential primary key is
enumerable, leaks volume, and would serialise every ledger write behind one sequence where
`uuidv7` is generated on the app server with no round trip. A `public_id` gets the short
number without any of that, which is why three tables already had one.

**The hourly board** — `room_hour_scores`, recomputed every 60s by `room_hour_rollup`, with
a daily purge. `GET /v1/rooms/:id/rank` returns position, progress toward the place above,
and the coins behind both; `GET /v1/rooms/board` returns the top rooms. A room nobody has
gifted in returns `null`, not a zero.

**Exit criteria met:** 10 tests covering codes, lookup of an ended room, range-checking the
code, ranking, the progress fraction, the leader's absent bar, idempotency and the hourly
reset · Postman updated · typecheck, lint and Prettier clean · both locales.

**Outstanding:** the board is polled, not pushed — the worker could publish to each room on
every rollup, which is one message per room per minute and better UX. `board` is only
`hour`; the references also run a popularity board and a daily one.

---

### M16 · Two promises the code was not keeping — ✅ COMPLETE, unverified on devices

Built 2026-10-15. Both were **defects rather than features**: the data said one thing and
the code did another.

**Tier 5 gifts now reach the whole platform.** Rocket (₹7,273) and Galaxy (₹15,000) are
sold as all-rooms announcements and reached exactly the room they were sent in. Now a
single `global` Redis channel every gateway subscribes to for its whole life — one publish
per gift, never one per live room, which would get worse exactly as the platform gets
busier. Clients receive `gift:global`, deliberately a different message from `gift`: one
means "in your room" and plays full-screen, the other means "somewhere else" and draws a
marquee banner. **The `effect` column decides, not the tier number**, so repricing the
ladder cannot silently change how loud a gift is — asserted by a test.

**`free_at_user_level` is no longer dead data.** `frame_basic` advertised itself free at
level 31 and `entry_basic` at level 16, both were returned to the app in the catalog, and
the column had been read by nothing since migration 003. Migration 030 makes `expires_at`
nullable (null = never, because a level does not lapse), adds `source` so support can
answer "why does this user have a frame they never bought", backfills everyone already
qualified, and grants on purchase as levels move. Granted **unequipped** — buying equips
because the person chose it; a reward arriving in the background has not been chosen.

**Found on the way:** `listOwned` called `expires_at.toISOString()` and 500'd on the first
null; four read sites needed `(expires_at IS NULL OR expires_at > now())`. And buying
something you already own permanently is now **refused** rather than charged —
`cosmetic_purchases.expires_at` is NOT NULL, so the alternatives were taking gems for
nothing or extending an expiry that does not exist.

**Exit criteria met:** 509 backend tests (8 new) · 144 mobile · typecheck, lint and
Prettier clean · both locales · Postman updated.

**Also:** the room leaderboard is now cached in memory for 5s per room. The room rebuild
turned it from sheet content into room chrome — the header's top-gifter rail and every
seat's counter read from it — so every viewer polls it every 5s, making it the only query
whose cost scales with viewer count. At 300 concurrent that was ~120 queries/second
against a 1 vCPU database to compute the same answer repeatedly. A test asserts ten
consecutive reads cost **zero** queries. In memory rather than Redis because at one
instance it is a Map lookup instead of a round trip and adds no failure mode; at ten
instances it degrades to ten computations per window instead of one, which is still 60×
better than none.

---

### M17 · Host verification and the admin panel — ✅ COMPLETE, unverified on devices

Built 2026-10-16. Day-1 non-negotiable #10 — the panel was "part of the MVP, not later"
and had been `export {}` since M1.

**Verification** (migration 031). Two checks: phone OTP plus a **face photo reviewed by a
human** once, and a selfie **captured at every go-live** and queued for review.

*Nothing is gated on a face check.* A gate fails on real hosts in bad light, and every
false reject is a host who cannot earn. What makes a late catch good enough is the payout
hold: earnings sit 7–14 days, so a handoff caught within a day is caught before money
leaves. The one hard stop is suspension. Research and reasoning in
`docs/face-verification.md`; it also meant **no new native dependency** — without liveness
there are no frame processors, so `expo-image-picker` suffices.

**Three severities**, because the cases differ: `flag` (invisible, queues every future
stream), `end_room` (a correction — they can start another), `suspend` (stops them going
live at all, and closes whatever they are broadcasting now). A content moderator may flag;
only a lead may suspend.

**The admin panel** — server-rendered HTML on the existing Express app. One thing to
deploy, one auth system, one set of modules, no second frontend before there is a first
user. Four screens: review queue, live rooms, users, enforcement log.

**Security, which is most of the work:**

- `html` is a tagged template that **escapes every interpolation**; `raw()` is the
  spelled-out opt-out. An XSS here is script in a session that can suspend accounts and
  read every host's photo. Tested with a hostile display name.
- Its own **CSP**: `script-src 'none'` (there is no JavaScript on any page), `style-src
  'self'` (the stylesheet is a route, not an inline block), images only from itself and
  the photo bucket.
- Session cookie is **HttpOnly, SameSite=Strict, Path=/admin** — never sent to `/v1`, so
  an admin session cannot be replayed against the API. **Roles are re-read from the
  database on every request**: the cookie proves who, the database decides what.
- **CSRF token in every form**, compared in constant time, on top of SameSite.
- Sign-in says the same thing for a wrong password and an unknown account.

**`enforcement_actions` is append-only by trigger.** A moderation log that can be
rewritten is not evidence, and the appeal flow depends on a second reviewer seeing exactly
what the first one did.

**Exit criteria met:** 532 backend tests (18 new) · 144 mobile · typecheck, lint and
Prettier clean · smoke-tested end to end against a running server: sign in, queue, rooms,
users, log, CSRF refusal, and a planted `<script>` rendering escaped.

**Found on the way:** one admin test passed for the wrong reason — it took its CSRF token
from a page that has none, so a role assertion was actually asserting a CSRF rejection.
And `useGoLive` re-declared a narrower input than its endpoint, so `coverKey` was already
flowing through untyped; spreads dodge excess-property checking, which is why nothing
caught it.

**Outstanding:** reports queue is not in the panel yet (the table and the API exist);
appeals (M9); and the `requireApprovedToGoLive` dial is **false** for the beta, because
the seeded hosts are onboarded by hand and gating them on a queue nobody is watching yet
would stop the platform before it starts.

---

### M18 · Kill switches, the back office, and the host's side of enforcement — ✅ COMPLETE, unverified on devices

Built 2026-10-23, in the order agreed that morning: commit the pending work · force-update
and kill switches · the host verification screen · the reports queue · CI · appeals · the
agency back office · catalog editing · the transactions screen. The new-user rewards sheet
and the feed's server-side search and seat-face cards from the day before went in first,
as their own commit.

**Kill switches** (migration 033). The force-update gate and the client flags had existed
since 007; what was missing was the thing an incident needs — ONE write that stops a
feature on the server (`requireFeature()` refuses), in the ledger (the feature's
`ledger_txn_types.is_active`) and in the app (the derived client flag), recorded in the
append-only `config_changes` with who and why. Nine switches; a key missing from the row
is ON, so a typo can never switch the product off. The app shows a designed paused state
for each — the go-live door, the rewards screen, the store, the wallet, agency transfers.

**Verification screen** — the "Auth" entry on the reference Me screen. Two steps on one
page: the phone number (already verified for most) and a face photo a person reviews; the
status strip says pending / approved / rejected with the reviewer's note. Takes the photo
with `expo-image-picker` (no new native dependency), uploads under the avatar purpose,
submits the key. A row on Me carries the state.

**Reports queue** — the table and the API had existed since 008 with nobody able to see
them. Live-room reports first. A decision about the PERSON (flag, suspend) closes every
open report about them; a dismissal closes only the one in hand; the action is taken
before the report is closed, so a failed suspension leaves the report visible.

**CI** had failed on every push since the first run. Not code: the backend job had no
Redis service (the room bus) and none of the provider env the local `.env` supplies
(`EMAIL_PROVIDER=console`, `MSG91_AUTH_KEY`). Fixed in the workflow.

**Appeals** (migration 034). One appeal per suspension (`appeals.action_id` UNIQUE on
the enforcement row), decided by someone OTHER than the person who suspended them — the
form knows who you are and refuses the suspender — and lifting goes through `enforce()`
with `source = 'appeal'`. The host sees it at the go-live door, on a Me card, and on the
appeal screen; the reviewer's note is shown, the moderator's suspension note is not.

**Agency back office** — M12's API-only actions as pages: list and search, create,
grant coin trading, record a prepay, confirm it as a DIFFERENT person (the database's
maker-checker constraint, now also a named refusal `PREPAY_SAME_PERSON`), suspend with a
reason, the transfer audit by user ID. **Catalog** — gift prices and per-gift payout,
packs, and the free-coin, new-user and cold-start dials, each validated with the schema
the reading code uses (moved to `shared/rewardsConfig.ts`), each recorded in
`config_changes`. Nothing re-prices anything already sent: `gift_sends` carries its
points at the moment of sending.

**Transactions screen** — the wallet statement, grouped by IST day, each row showing
every balance it moved in its reserved currency colour, paged by uuidv7 id.

**Found on the way:** the backend has no Prettier config and a run with defaults had
turned seven files to double quotes — restored. A test's CSRF token came from a page
with no form on it, so the sign-out form now carries the token on every page.

**Exit criteria met:** 573 backend tests · 153 mobile ·
`npm run check` clean · CI green on `main` for the first time.

**Outstanding:** device verification of everything since M5; the legal pages' text and
the Grievance Officer's name; platform rankings and the region picker, both waiting on a
decision (daily or weekly boards; what a region is).

---

### M18 · Kill switches, the back office, and the host's side of enforcement — ✅ COMPLETE, unverified on devices

Built 2026-10-23, in the order agreed that morning: commit the pending work · force-update
and kill switches · the host verification screen · the reports queue · CI · appeals · the
agency back office · catalog editing · the transactions screen. The new-user rewards sheet
and the feed's server-side search and seat-face cards from the day before went in first,
as their own commit.

**Kill switches** (migration 033). The force-update gate and the client flags had existed
since 007; what was missing was the thing an incident needs — ONE write that stops a
feature on the server (`requireFeature()` refuses), in the ledger (the feature's
`ledger_txn_types.is_active`) and in the app (the derived client flag), recorded in the
append-only `config_changes` with who and why. Nine switches; a key missing from the row
is ON, so a typo can never switch the product off. The app shows a designed paused state
for each — the go-live door, the rewards screen, the store, the wallet, agency transfers.

**Verification screen** — the "Auth" entry on the reference Me screen. Two steps on one
page: the phone number (already verified for most) and a face photo a person reviews; the
status strip says pending / approved / rejected with the reviewer's note. Takes the photo
with `expo-image-picker` (no new native dependency), uploads under the avatar purpose,
submits the key. A row on Me carries the state.

**Reports queue** — the table and the API had existed since 008 with nobody able to see
them. Live-room reports first. A decision about the PERSON (flag, suspend) closes every
open report about them; a dismissal closes only the one in hand; the action is taken
before the report is closed, so a failed suspension leaves the report visible.

**CI** had failed on every push since the first run. Not code: the backend job had no
Redis service (the room bus) and none of the provider env the local `.env` supplies
(`EMAIL_PROVIDER=console`, `MSG91_AUTH_KEY`). Fixed in the workflow.

**Appeals** (migration 034). One appeal per suspension (`appeals.action_id` UNIQUE on
the enforcement row), decided by someone OTHER than the person who suspended them — the
form knows who you are and refuses the suspender — and lifting goes through `enforce()`
with `source = 'appeal'`. The host sees it at the go-live door, on a Me card, and on the
appeal screen; the reviewer's note is shown, the moderator's suspension note is not.

**Agency back office** — M12's API-only actions as pages: list and search, create,
grant coin trading, record a prepay, confirm it as a DIFFERENT person (the database's
maker-checker constraint, now also a named refusal `PREPAY_SAME_PERSON`), suspend with a
reason, the transfer audit by user ID. **Catalog** — gift prices and per-gift payout,
packs, and the free-coin, new-user and cold-start dials, each validated with the schema
the reading code uses (moved to `shared/rewardsConfig.ts`), each recorded in
`config_changes`. Nothing re-prices anything already sent: `gift_sends` carries its
points at the moment of sending.

**Transactions screen** — the wallet statement, grouped by IST day, each row showing
every balance it moved in its reserved currency colour, paged by uuidv7 id.

**Found on the way:** the backend has no Prettier config and a run with defaults had
turned seven files to double quotes — restored. A test's CSRF token came from a page
with no form on it, so the sign-out form now carries the token on every page.

**Exit criteria met:** 573 backend tests · 153 mobile ·
`npm run check` clean · CI green on `main` for the first time.

**Outstanding:** device verification of everything since M5; the legal pages' text and
the Grievance Officer's name; platform rankings and the region picker, both waiting on a
decision (daily or weekly boards; what a region is).

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
