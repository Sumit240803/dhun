# Ledger design — decision checklist

Nothing in the ledger gets built until its item here is resolved. Mark each item
`DECIDED` with the decision inline, or leave `OPEN`.

Legend: **[R]** = recommendation on the table, waiting for confirm/veto ·
**[?]** = genuinely needs a decision, no default · **[D]** = decided

---

## A. Core model & invariants — ✅ CLOSED

| # | Decision |
|---|---|
| A1 | **One `ledger_entries` table with a `unit` column.** Three units: `coin`, `point`, `paise`. Invariant is sum per `(txn_id, unit)` = 0. **Gems are an account, not a unit** — 1 gem = 1 coin in value, so conversion is a plain transfer inside the `coin` unit. |
| A2 | **`ledger_accounts` table**, keyed `(type, scope_type, scope_id, unit)`, **auto-provisioned on first use**. Avoids a signup-time fan-out of empty rows. |
| A3 | Store `type` (asset/liability/revenue/expense/contra) and `normal_direction` **for validation and reporting only**. Amounts use natural signs — a user's coin balance reads `+16445`, never `−16445`. Validation uses `type` to assert e.g. user liability accounts never go negative. |
| A4 | **Chart of accounts — locked. See below.** |
| A5 | **Single signed `amount` column.** Debit/credit columns double the code for no gain at this size. |
| A6 | **Both**: a `BEFORE UPDATE OR DELETE` trigger on `ledger_entries` that raises, **and** `UPDATE`/`DELETE` revoked from the app's DB role. Trigger catches app bugs; grants catch console mistakes and injection. Migrations run as a separate role. |
| A7 | **`DEFERRABLE INITIALLY DEFERRED` constraint trigger** checking sum-per-unit at COMMIT. Makes an unbalanced transaction *impossible*, not merely detected next morning. App-level assertion as well, for a better error message. |
| A8 | **Balance cache updated inside the same txn**; nightly job verifies cache == sum(entries). The ledger is authoritative, the cache is a cache — this satisfies "balance is never a mutable column". Do not let anyone "fix" this later. |
| A9 | **`bigint` everywhere.** Coins, gems and points as whole units; INR always as **paise**. Never float. Whale lifetime ~65M coins against bigint's 9.2×10¹⁸ — vast headroom. |
| A10 | Rates stored as **integer basis points** (60% = `6000`). **Floor division.** Points are already the smallest unit, so a floored fraction is simply never issued — no residual account needed, *provided* reconciliation check E6 recomputes with the identical integer expression. |

### A4 · Chart of accounts

**`coin` unit** — gems live here too, since 1 gem = 1 coin in value

| Account | Type | Notes |
|---|---|---|
| `user:{id}:coins` | liability | purchased **and** free; giftable; never negative |
| `user:{id}:gems` | liability | cosmetics only; never negative |
| `system:coin_float` | contra-liability | mirrors every user coin + gem balance |

**`point` unit**

| Account | Type | Notes |
|---|---|---|
| `host:{id}:points_held` | liability | inside the 7 / 14-day hold |
| `host:{id}:points_withdrawable` | liability | released, requestable |
| `host:{id}:points_pending_payout` | liability | requested, not yet settled at bank |
| `system:point_float` | contra-liability | mirrors every host point balance |

**`paise` unit**

| Account | Type | Notes |
|---|---|---|
| `asset:cash:iap` / `:web` / `:reseller` | asset | **gives the channel-mix dial directly** |
| `asset:bank` | asset | |
| `liability:deferred_revenue` | liability | the coin + gem float, in rupees |
| `liability:points_payable` | liability | owed to hosts |
| `liability:tds_payable` | liability | |
| `liability:agency_commission_payable` | liability | |
| `revenue:gifting` | revenue | |
| `revenue:cosmetics` | revenue | **the 75–80 / 20–25 split reads straight off these two** |
| `contra_revenue:pack_discount` | contra-revenue | keeps every unit worth exactly 1/65 ₹ |
| `contra_revenue:conversion_bonus` | contra-revenue | the +20% coins→gems bonus |
| `contra_revenue:reseller_discount` | contra-revenue | reseller buys at ~88 coins/₹, sells at face |
| `expense:host_payout_cost` | expense | |
| `expense:free_coins` | expense | **the ≤8% budget check** |
| `expense:agency_commission` | expense | |
| `expense:chargeback_loss` | expense | |
| `expense:host_guarantee_topup` | expense | the ₹15,000/month seeding |
| `expense:payout_fees` | expense | ~₹8 per payout |

Gross issued/redeemed figures come from querying by **txn type**, not from separate
accounts — which is why one float account per unit is enough.

**Structural bonus:** reconciliation check **E3** (coin float = issued − spent) becomes
*automatically* true in this model — it is just the global sum-to-zero. A check that cannot
drift beats one that has to be run.

### A4 · Worked examples

Rates are stored **on the transaction** (see G1), so a later retune never rewrites history.

**Purchase — ₹299 Popular pack** (16,445 coins + 5,355 gems; face value ₹335.38)

```
coin    user:{u}:coins                 +16,445
        user:{u}:gems                   +5,355
        system:coin_float              −21,800        → 0 ✓

paise   asset:cash:web                 +29,900
        contra_revenue:pack_discount    +3,638
        liability:deferred_revenue     −33,538        → 0 ✓
```

**Gift — Yacht, 19,500 coins, payout_rate 6000 bp**

```
coin    user:{u}:coins                 −19,500
        system:coin_float              +19,500        → 0 ✓

point   system:point_float             −11,700        (19,500 × 0.60)
        host:{h}:points_held           +11,700        → 0 ✓

paise   liability:deferred_revenue     +30,000        (₹300 face)
        revenue:gifting                −30,000
        expense:host_payout_cost        +9,000        (₹90 = 11,700 ÷ 130)
        liability:points_payable        −9,000        → 0 ✓
```

**Cosmetic — profile frame, 3,250 gems.** No point legs at all; this is the zero-payout path.

```
coin    user:{u}:gems                   −3,250
        system:coin_float               +3,250        → 0 ✓

paise   liability:deferred_revenue      +5,000
        revenue:cosmetics               −5,000        → 0 ✓
```

**Conversion — 6,500 coins → 7,800 gems (+20%).** The bonus mints 1,300 new units, so it
needs a source in both books.

```
coin    user:{u}:coins                  −6,500
        user:{u}:gems                   +7,800
        system:coin_float               −1,300        → 0 ✓

paise   contra_revenue:conversion_bonus  +2,000       (₹20 of newly minted face value)
        liability:deferred_revenue      −2,000        → 0 ✓
```

**Free coin grant — signup, 500 coins**

```
coin    system:coin_float                 −500
        user:{u}:coins                    +500        → 0 ✓

paise   expense:free_coins                 +769       (₹7.69 face)
        liability:deferred_revenue         −769       → 0 ✓
```

## B. Transaction mechanics — ✅ CLOSED

| # | Decision |
|---|---|
| B1 | **Idempotency key lives on `ledger_txns`**, one per transaction — *not* per entry as the scaffold has it. Globally unique, client-generated UUID v4. |
| B2 | **Strict replay.** See below. |
| B3 | Key retained **forever** (part of the audit trail); the cached *response body* dropped after **7 days**. A replay after that returns `200` with a minimal `{already_applied, ref_id}` body. |
| B4 | **Lock only accounts being debited**, in ascending account id, via `SELECT … FOR UPDATE`. Credits cannot overdraft so they need no lock. **System accounts get no balance cache at all** — see the hotspot note below. |
| B5 | **READ COMMITTED + explicit `FOR UPDATE`.** SERIALIZABLE would need retry loops on hot rows at gift volume. |
| B6 | **38 types in a lookup table** (not a Postgres enum, so adding one is an `INSERT`). Full list below. |
| B7 | Never edit or delete — post a **compensating transaction** with negated entries and `reverses_txn_id` set. The reversal keeps the **original type**; sign carries direction, so no mirror types. Partial reversals allowed; total reversed may not exceed the original; a reversal cannot itself be reversed (correct the original instead). |
| B8 | **Transactional outbox** for the durable path, **Redis pub/sub** for the live UI. See below. |

### B2 · Strict idempotency

Three cases:

| Situation | Response |
|---|---|
| Same key, same identity, first request **finished** | `200` + the **original response body**, byte-identical, plus `Idempotent-Replay: true` |
| Same key, first request **still in flight** | `409 REQUEST_IN_PROGRESS` — client retries shortly |
| Same key, **different identity** | `422 IDEMPOTENCY_KEY_REUSED` |

The in-flight case works because the `ledger_txns` row is inserted with status `pending`
**before** any work happens — the UNIQUE constraint rejects the racing duplicate instantly.

**Keys bind to operation identity, not a request-body hash.** A body hash breaks when a
client adds an optional field or reorders JSON; identity fields don't, and they're readable
in the database during support work. Stored as `jsonb` on `ledger_txns`:

| Endpoint | Identity |
|---|---|
| Purchase (IAP) | `pack_id`, `platform` |
| Purchase (web) | `pack_id` |
| Gift send | `gift_id`, `host_id`, `room_id`, `quantity` |
| Cosmetic purchase | `item_id`, `duration_days` |
| VIP purchase | `tier`, `months` |
| Coins → Gems | `coin_amount` |
| Payout request | `host_id`, `amount_paise` |

**Purchases need a second, independent lock.** The idempotency key stops *your client*
double-charging; it does nothing against a **replayed store receipt** submitted with a fresh
key — a known mobile-games fraud route. So:

```sql
UNIQUE (provider, provider_txn_id)   -- google_play | app_store | razorpay
```

Neither guarantee substitutes for the other.

### B4 · The system-account hotspot

Every transaction touches `system:coin_float`. If system accounts carried cached balances
like user accounts, **every gift in the system would serialise on one row** — a hard
throughput ceiling reached well before 10K DAU.

**Fix: materialise balances for user and host accounts only.** The cache exists for fast
wallet reads and non-negativity enforcement; system accounts need neither. They are read
once a night by reconciliation, which can afford a `SUM()` over a partitioned table or a
nightly rollup.

Consequence: a gift locks exactly **one** row — the sender's coin account. Effectively no
deadlock surface.

### B6 · Transaction types (38)

Lookup table `ledger_txn_types`, one row per type, carrying:

`code` · `category` · `phase` (0/1/2) · `units_touched` · `requires_maker_checker` ·
`reversible` · **`is_active`** · `description`

`is_active` is deliberate: it delivers the day-1 "remote kill switch per major feature"
requirement **at the money layer**. Flip `gift_send` inactive and gifting stops atomically,
with no deploy.

**Coins in (7)**
`purchase_iap` · `purchase_web` · `purchase_reseller` · `reseller_prepay` ·
`free_coin_grant` · `promo_grant` · `admin_credit`

`free_coin_grant` carries a subtype — `signup` / `daily_checkin` / `watch_reward` /
`follow` / `share` / `referral` / `daily_spin` — rather than being seven types, since the
leg structure is identical.

**Coins & gems out (8)**
`gift_send` · `cosmetic_purchase` · `cosmetic_grant` · `vip_purchase` · `vip_renewal` ·
`vip_refund` · `coin_to_gem_conversion` · `admin_debit`

`cosmetic_grant` is the free unlock at user levels 16–30 (entry effect) and 31–50 (frame) —
a cosmetic appearing with no gem spend.

**Host-earning features (5)** — Phase 1–2, listed now so nothing is architecturally surprising
`fan_club_join` · `fan_club_renewal` · `private_call_charge` · `room_entry_fee` ·
`guardian_slot_purchase`

Unlike cosmetics, these all have a **points leg** — the host earns from them.

**Points lifecycle (3)**
`points_hold_release` · `host_referral_bonus` · `host_guarantee_topup`

**Agency (3)**
`agency_commission_accrual` · `agency_commission_payout` · `agency_incentive_payout`

Platform pays the **agency only** — never a sub-agent. The agency settles with its own
sub-agents off-platform. This is hard rule #2 and must never acquire a transaction type.

**Payouts (8)**
`payout_request` · `payout_settled` · `payout_failed` · `payout_rejected` ·
`payout_cancelled` · `payout_clawback` · `tds_withheld` · `gst_added`

Three distinct reversal paths on purpose: `failed` = bank error, `rejected` = approver
decision, `cancelled` = host's own action. Same ledger effect, very different reporting.

**Corrections & losses (4)**
`chargeback` · `refund` · `ban_forfeiture` · `abandonment_forfeiture`

### B8 · Outbox and the live path

Events are written to an `outbox` table **inside the same transaction** as the ledger write.
Without that, a crash between commit and publish silently loses the event and analytics
drift permanently.

But a polling shipper adds latency, and a gift animation arriving half a second late reads
as broken. So **two paths**:

- **Fast path** — after commit, publish straight to Redis pub/sub for the room UI.
  Best-effort; a dropped message costs one missed animation.
- **Durable path** — the outbox feeds analytics, leaderboard, notifications, and anything
  financial. At-least-once, so every event carries a stable `event_id` and consumers dedupe
  on it.

Ordering is guaranteed **per partition key** (room or user), never globally — which is all
any consumer actually needs. Shipper wakes on `LISTEN`/`NOTIFY` rather than tight polling.

## C. Money flows — leg structure must be defined for each

### Coins in
| # | Flow | Status |
|---|---|---|
| C1 | IAP purchase (Play / App Store) — including receipt verification failure and refund webhook | [?] |
| C2 | Web gateway purchase | [?] |
| C3 | Reseller prepay (reseller buys bulk coins with own money) | [?] |
| C4 | Reseller → user coin transfer | [?] |
| C5 | Free coin grant (signup, check-in, watch, follow, share, referral) — 6 sources, one flow shape, differing only by txn subtype | **[D]** see A4 worked example |
| C6 | ~~Bonus coin expiry sweep~~ — **eliminated.** Free coins are ordinary coins and never expire. | **[D]** dropped |

### Coins out
| # | Flow | Status |
|---|---|---|
| C7 | Gift — 8 legs across `coin` / `point` / `paise` | **[D]** see A4 worked example |
| C8 | ~~Gift with bonus coins at 20%~~ — **eliminated.** One payout rate only. | **[D]** dropped |
| C9 | ~~Mixed paid + bonus gift~~ — **eliminated** by the same change. | **[D]** dropped |
| C10 | Combo gift x10/x99/x520/x999 — one txn with quantity, or N txns | [R] one txn |
| C11 | Cosmetic purchase — gems → revenue, **zero points**, no host leg | **[D]** see A4 worked example |
| C11b | **Coins → Gems conversion** (+20%, one-way, config-driven) | **[D]** see A4 worked example |
| C12 | VIP subscription purchase and monthly renewal — priced in gems; is renewal a fresh txn or a scheduled deduction? | [?] |

### Points
| # | Flow | Status |
|---|---|---|
| C13 | Hold → withdrawable release (7 day standard / 14 day new host) | [R] account transfer |
| C14 | Host referral bonus — +10% points for 3 months on referred users' gifts | [?] |
| C15 | Host seeding guarantee — ₹15,000/month top-up, M1–3 full, M4–6 `max(guarantee, actual)` | [?] |
| C16 | Agency commission accrual (trailing 30d tier, split by **gift timestamp**, platform-funded) | [?] |
| C17 | Agency commission payout | [?] |

### Payouts
| # | Flow | Status |
|---|---|---|
| C18 | Withdrawal request — does a `pending_payout` account hold funds between request and bank success? | [?] |
| C19 | Payout success — points → bank, minus TDS | [?] |
| C20 | TDS withholding entry (rate/threshold behind a strategy interface until CA decides) | [?] |
| C21 | GST-registered host — +18% added to payout, self-billing invoice | [?] |
| C22 | Payout failure → reversal back to withdrawable | [R] compensating txn |

### Corrections & losses
| # | Flow | Status |
|---|---|---|
| C23 | Chargeback after coins already spent — platform bears the loss, **no host clawback** | [?] |
| C24 | Ban forfeiture — L1 = forfeit balance, L2/L3 = payout allowed | [?] |
| C25 | Abandoned account — 24-month forfeiture / escheat | [?] |
| C26 | Manual admin adjustment / goodwill credit — does it require maker-checker too? | [?] |
| C27 | Duplicate payout caused by a bug — clawback path | [?] |

## D. Derived values — from the ledger, or separate counters?

| # | Item | Status |
|---|---|---|
| D1 | **User level** — lifetime *paid* coin spend, bonus excluded, never decreases | [?] |
| D2 | **Host level** — cumulative points earned | [?] |
| D3 | **Trailing-30-day host earnings** for the agency commission tier — live query or rollup table | [?] |
| D4 | **TDS running total** per host per financial year (Apr–Mar) — needs its own accumulator | [?] |
| D5 | **Coin float liability** and revenue-recognition reporting | [?] |

## E. Reconciliation — the six mandated checks

| # | Check | Status |
|---|---|---|
| E1 | Every account's cached balance == sum of its entries | [?] |
| E2 | Every txn's entries sum to 0, per unit | [?] |
| E3 | Coin float: issued − spent == outstanding liability | [?] |
| E4 | Yesterday's payouts match the bank statement | [?] |
| E5 | Yesterday's recharges match PG settlement | [?] |
| E6 | Points issued == gift value × payout rate | [?] |
| E7 | **Tolerance = zero?** And on mismatch: page only, or freeze payouts automatically? | [?] |

## F. Schema & scale

| # | Item | Status |
|---|---|---|
| F1 | Table definitions: `ledger_accounts`, `ledger_txns`, `ledger_entries`, `outbox`, balance cache | [?] |
| F2 | Indexes, driven by real query patterns (account history, per-txn, per-user, time-range rollups) | [?] |
| F3 | **Partitioning** — `ledger_entries` grows fastest of anything in the system. Monthly partitions from day 1, or defer? | [?] |
| F4 | Archival — never delete; cold-storage strategy for old partitions | [?] |
| F5 | Constraints — FKs, checks, non-negative balance enforcement (can a host ever go negative via clawback?) | [?] |

## G. Operations & testing

| # | Item | Status |
|---|---|---|
| G1 | **Rate immutability** — a gift's `payout_rate` and the coin/point rates used must be stored **on the txn**, so a later price change never retroactively reinterprets history | [R] store on txn |
| G2 | Kill-switch interaction — what happens to in-flight transactions when gifting is disabled | [?] |
| G3 | Admin read access + audit log (who viewed, who adjusted) | [?] |
| G4 | Test strategy — property test (sum always zero), concurrency test (parallel gifts, no deadlock, no double-spend), replay test (idempotency) | [?] |
| G5 | Seeding / fixtures for local dev and the Postman collection | [?] |

## H. Policy calls that change the schema

| # | Item | Status |
|---|---|---|
| H1 | Multi-currency ever, or INR-only forever? Affects whether `paise` is a unit or a currency+amount pair | [?] |
| H2 | Can any balance go negative, under any circumstance? | [?] |
| H3 | Do resellers and agencies get real ledger accounts, or are they tracked outside the ledger? | [?] |
| H4 | Is the gift `quantity`/combo a first-class ledger concept or purely an event property? | [?] |
| H5 | Does the ledger record the *channel* (iap/web/reseller) per purchase, for the channel-mix dial? | **[D]** yes — three separate `asset:cash:*` accounts, so channel mix is a balance read |
