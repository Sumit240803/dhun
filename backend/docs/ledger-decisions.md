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
| `contra_revenue:reseller_discount` | contra-revenue | the wholesale spread: an agency buys coins below the retail 55/₹ rate (recommended 62–70/₹ by volume) and resells at its own price |
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
Counts below are post-redenomination (110 coins/₹, 130 units/₹ face, 260 points/₹); every
rupee figure is unchanged from before it, which is the whole point of that change.

**Purchase — ₹299 Popular pack** (32,890 coins + 10,710 gems; face value ₹335.38)

```
coin    user:{u}:coins                 +32,890
        user:{u}:gems                  +10,710
        system:coin_float              −43,600        → 0 ✓

paise   asset:cash:web                 +29,900
        contra_revenue:pack_discount    +3,638
        liability:deferred_revenue     −33,538        → 0 ✓
```

**Gift — 39,000 coins (₹300 of face value), payout_rate 6000 bp**

```
coin    user:{u}:coins                 −39,000
        system:coin_float              +39,000        → 0 ✓

point   system:point_float             −23,400        (39,000 × 0.60)
        host:{h}:points_held           +23,400        → 0 ✓

paise   liability:deferred_revenue     +30,000        (₹300 face)
        revenue:gifting                −30,000
        expense:host_payout_cost        +9,000        (₹90 = 23,400 ÷ 260)
        liability:points_payable        −9,000        → 0 ✓
```

**Cosmetic — profile frame, 6,500 gems.** No point legs at all; this is the zero-payout path.

```
coin    user:{u}:gems                   −6,500
        system:coin_float               +6,500        → 0 ✓

paise   liability:deferred_revenue      +5,000
        revenue:cosmetics               −5,000        → 0 ✓
```

**Conversion — 13,000 coins → 15,600 gems (+20%).** The bonus mints 2,600 new units, so it
needs a source in both books.

```
coin    user:{u}:coins                 −13,000
        user:{u}:gems                  +15,600
        system:coin_float               −2,600        → 0 ✓

paise   contra_revenue:conversion_bonus  +2,000       (₹20 of newly minted face value)
        liability:deferred_revenue      −2,000        → 0 ✓
```

**Free coin grant — signup, 1,000 coins**

```
coin    system:coin_float               −1,000
        user:{u}:coins                  +1,000        → 0 ✓

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
| Gift send | `gift_id`, `recipient_id`, `room_id`, `quantity` — *recipient*, not host: in a party room a gift can go to anyone on a seat |
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

~~Platform pays the agency only.~~ **Superseded 2026-09-28:** host, sub-agent and agency
each earn points and withdraw directly (§ "The payout flow"). Hard rule #2 now reads: nobody
is paid through anybody else — an agency never handles a sub-agent's or a host's money.

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
| C3 | Reseller prepay (reseller buys bulk coins with own money) | **[D]** see below |
| C4 | Reseller → user coin transfer | **[D]** see below |
| C5 | Free coin grant (signup, check-in, watch, follow, share, referral) — 6 sources, one flow shape, differing only by txn subtype | **[D]** see A4 worked example |
| C5b | **Free coin claims — amounts, caps and once-only** | **[D]** Amounts and caps from economy-design-v1 § 6, held in `app_config.free_coins` so they can be cut without a release (the doc's own lever when free-coin cost passes 8%). The ledger idempotency key is DERIVED FROM THE CLAIM (`checkin:{user}:{IST date}`, `watch:{user}:{date}:{n}`, `signup:{user}`, `referral:{referred user}`), never from a client header — the same reasoning as purchases: a claim is the money event, and one claim must mean one credit. Every claim writes a `reward_claims` row inside the ledger transaction. Registered accounts only. Check-in ladder, which the doc gives only as 20 → 150: **20, 30, 40, 60, 80, 100, 150**, cycling after day 7, resetting to day 1 on a missed IST day. The welcome bonus is once per account AND once per device. Follow and share rewards are not built: share cannot be verified, and neither is in the build plan. |
| C5c | **Referral reward** | **[D]** 2,000 coins to the referrer when the referred user's FIRST purchase of at least ₹99 is credited (`referral.minPurchasePaise`, config). The doc says "friend recharge kare"; the ₹99 floor is added because the ₹19 starter pack would otherwise buy ₹31 of referral coins. Attached by entering the referrer's public ID within 7 days of signup, once, never to yourself, never across a shared device. Granted by the workers' outbox consumer — the durable path — keyed on the referred user, so a replayed event cannot pay twice. Clawback on refund or chargeback waits for C23/C24. |
| C6 | ~~Bonus coin expiry sweep~~ — **eliminated.** Free coins are ordinary coins and never expire. | **[D]** dropped |

### Coins out
| # | Flow | Status |
|---|---|---|
| C7 | Gift — 8 legs across `coin` / `point` / `paise` | **[D]** see A4 worked example |
| C8 | ~~Gift with bonus coins at 20%~~ — **eliminated.** One payout rate only. | **[D]** dropped |
| C9 | ~~Mixed paid + bonus gift~~ — **eliminated** by the same change. | **[D]** dropped |
| C10 | Combo gift x10/x99/x520/x999 — one txn with quantity, or N txns | **[D]** one txn, `coins = unit_price × quantity`. Quantity is one of 1/10/99/520/999 and nothing else. N transactions would be N row locks, N outbox rows and N animations for one tap. |
| C11 | Cosmetic purchase — gems → revenue, **zero points**, no host leg | **[D]** see A4 worked example |
| C11b | **Coins → Gems conversion** (+20%, one-way, config-driven) | **[D]** see A4 worked example |
| C11c | **Buying a cosmetic you already hold** | **[D]** One `cosmetic_purchase` txn per purchase, always the full price. Time is ADDED to the current expiry when the item is still active (`GREATEST(expires_at, now()) + duration`), so extending early never loses days already paid for. An expired item starts again from now. |
| C11d | **Where ownership lives** | **[D]** `user_cosmetics` holds one row per user per item with `expires_at`; `cosmetic_purchases` logs each purchase. Both are written by `postTransaction`'s in-transaction hook, like `gift_sends`, so an item cannot be owned without the gems having moved. Expiry is evaluated on READ (`expires_at > now()`) — nothing is deleted or swept, and a lapsed item simply stops being drawn. A cosmetic withdrawn from sale keeps working for whoever already bought it, until it expires. |
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

### C3 / C4 · The agency channel, worked

Two paths reach a user's coin balance. Most users take the second (see the app's coin
distribution model in CLAUDE.md).

**C3 — Agency prepay.** An agency pays the PLATFORM up front, by bank transfer, UPI or a
web gateway, and receives coins into an inventory account it cannot gift from. Same shape
as a pack purchase, with two differences: the coins land in `reseller:{id}:inventory`, and
there are no gems — an agency resells coins, and gems would be dead stock.

Example: ₹50,000 at a 132 coins/₹ wholesale rate → 6,600,000 coins (face ₹50,769.23 at the
65-units/₹ accounting rate).

```
coin    reseller:{r}:inventory       +6,600,000
        system:coin_float            −6,600,000        → 0 ✓

paise   asset:cash:reseller          +5,000,000        (₹50,000 actually received)
        contra_revenue:reseller_discount +76,923
        liability:deferred_revenue   −5,076,923        → 0 ✓
```

**Never on credit** (hard rule #3). The coins are minted by the payment being confirmed,
and the confirmation is a maker-checker admin action until a gateway automates it —
`reseller_prepay` already carries `requires_maker_checker`.

**C4 — Agency → user transfer.** The agency has been paid by the user OFF-PLATFORM. Our
books never see that money, which is precisely what keeps us a distributor rather than a
payment aggregator. So the transfer moves coins and nothing else:

```
coin    reseller:{r}:inventory         −10,000
        user:{u}:coins                 +10,000        → 0 ✓
```

No paise legs at all. The rupees were recognised as deferred revenue when the agency
prepaid, and become revenue when the user eventually SPENDS the coins — unchanged from
every other coin. A transfer that tried to book revenue would double-count it.

Three properties this shape gives for free:

- **The float still reconciles.** E3 (coin float = issued − spent) is the global sum to
  zero, and inventory is inside it.
- **Pay-first is enforced by the balance check.** An agency with 10,000 coins cannot
  transfer 11,000; the same code path that stops a user overdrafting stops this.
- **`purchase_reseller` touches `coin` only**, not `['coin','paise']` as seeded in
  migration 002. ✅ Corrected in migration 019.

Identity for the idempotency key: `{reseller_id, user_id, coins, request_id}`. The agency's
client generates the request id once per transfer, so a retry over a dropped connection
cannot send the coins twice.

**What this is NOT.** Hard rule #7 stands: no user-to-user transfer. This flow is
one-directional, from a verified agency's inventory to a user, and there is deliberately no
route back — a user cannot send coins to an agency, to another user, or to anyone else.

### M12 schema · migration 019

Built 2026-09-28. What each table guarantees, and where in the database it is enforced:

| Guarantee | Enforced by |
|---|---|
| An agency exists only because an admin created it | No application table; `agencies.created_by` is the admin |
| Every agency has an owner seat | `owner_agent_id` FK, deferred so both rows land in one transaction |
| A host sits with one agent at a time; an agent in one agency at a time | `EXCLUDE USING gist` on each dated link (`btree_gist`) |
| A join needs both sides' consent | `agency_join_requests`, one pending per host+agent pair |
| An agent cannot invite users by enumerating IDs | `host_join_codes` — the second factor |
| No coin exists that an agency did not pay for (hard rule #3) | `agency:{id}` `agency_inventory` account, non-negative |
| Maker ≠ checker on a prepay | `CHECK (decided_by <> recorded_by)` |
| One bank credit is minted once | `UNIQUE (method, payment_reference)` |
| A decided prepay is final; coins match the frozen rate | trigger `agency_prepays_final`; `CHECK coins = paise × rate / 100` |
| Transfers are a permanent, one-directional record (hard rule #7) | append-only trigger; no column can describe any other direction; no self-transfer |

`agency_listings` was created by 019 for a public agency list and **dropped by 022**: there
is no in-app directory (founder, 2026-10-05, build-plan M12). An agency's retail price is
agreed off-platform and we never record it.

`ledger_accounts.scope_type` now allows `agency`. `purchase_reseller` and `reseller_prepay`
are phase 0 but stay **inactive** — the kill switch is flipped when the service ships.

Config `agency`: ₹10,000 prepay floor; wholesale **124 / 132 / 140** coins/₹ at ₹10K / ₹50K /
₹2L+; transfer caps per transfer 1.1M coins, per recipient per IST day 5.5M, per agency per
day 22M and 500 transfers; join requests expire after 7 days.

**Settled 2026-09-28 (founder):** commission levels are **D/C/B/A/S**, not nine; and
everyone — host, sub-agent, agency — earns points and withdraws them directly. 019 seeds
`commission_levels` and `withdrawals`, and adds `agent`-scoped point accounts alongside the
agency ones. CLAUDE.md hard rule #2 was reworded to match.

### M12 membership · migration 020

Built 2026-10-05. No money moves; these are the rules the commission engine will read
through the dated links.

**Joining** needs both sides: an application to an Agent ID the agent accepts, or an invite
by User ID + Host Code the host accepts. A host in an agency cannot apply elsewhere or be
invited elsewhere (no poaching). Accepting cancels the host's other open requests. Every
membership change locks the host's user row first, so two concurrent accepts queue rather
than one failing on the no-overlap constraint.

**Quitting** — the founder's rules, taken from the competitor flow:

1. An application nobody acts on for **7 days** lets the host go automatically
   (`agency_membership_sweep`, every 15 minutes).
2. A host who has **never attempted face authentication** leaves at once.
   (`users.face_auth_attempted_at`, set by M8. Until then every quit is immediate — the
   honest reading of the rule.)
3. A host who **joined under 24 hours ago** leaves at once.
4. **One application per 30 days**, whatever became of the last one.
5. After rejecting, the owner may still **approve within 14 days**.

Only the **agency owner** decides — never a sub-agent, never the platform. The platform plays
no part in a host leaving. All four timings are in `app_config.agency.quit`.

**Commission is unaffected by leaving mid-period.** Each gift is attributed by its timestamp
to the agent and agency the host was with at that moment.

**New agencies get lower transfer caps** for their first 30 days
(`app_config.agency.newAgency`) — fraud and laundering cluster in a new agency's first weeks.
Enforced when the transfer service is built.

### M12 coin channel · migration 021

Built 2026-10-05, to the leg structure in C3/C4 above. What the code adds to it:

- **The prepay's ledger key is `prepay:{id}`**, derived from the record, never a client
  header — the same reasoning as a purchase keying off its receipt. A raced or retried
  confirmation therefore mints once; the test fires four at a time and asserts one credit.
- **The transfer's key is `transfer:{agency}:{request_id}`**, with `UNIQUE (agency_id,
  request_id)` on `agency_transfers` behind it, so neither layer is the only thing holding
  that guarantee.
- **The discount leg is SIGNED, and at our wholesale rates it is a premium.** A pack hands
  over more face value than it collects (110 coins/₹ against the 130/₹ accounting rate);
  wholesale is the other way (124 coins/₹), so `discount_reseller` is credited rather than
  debited. Either direction keeps every coin worth exactly 1/130 of a rupee, which is the
  invariant that matters.
- **Caps are read inside the posting transaction**, under the same row lock the balance
  check takes, so two simultaneous transfers cannot both pass the last one. They are
  counted per **IST** day — a cap resetting at 05:30 is not the cap anyone agreed to.
- **Coin trading is a grant per agency** (`agencies.coin_trading_enabled_at`), operated by
  the **owner only**. Withdrawing it stops new transfers at once and leaves the inventory
  alone: those coins were paid for and are the agency's.
- **Both txn types are now `is_active = true`.** That column remains the money-layer kill
  switch — set either false and the flow stops platform-wide, atomically, with no deploy.

**Reconciliation covers the channel** (two checks added 2026-10-05, both zero-tolerance and
both paging):

- `agency_prepays_match_ledger` — every confirmed prepay has a transaction behind it, minted
  exactly the coins it was quoted, and `cash_reseller` equals the sum of confirmed prepay
  amounts. That last figure is the one a CA reconciles against the bank statement.
- `agency_transfers_match_ledger` — every completed transfer has one record, for exactly the
  coins the ledger moved. The record is the only evidence either side has about a payment we
  never saw, so a missing one is a dispute nobody can settle.

Inventory going negative is already caught by `no_negative_user_balances`, which covers every
tracked account, and the coin float by E3 — inventory sits inside it.

### M12 sub-agents · migration 023

Built 2026-10-05. No money moves; these are the links the commission engine will walk.

- **An agent seat needs consent.** A sub-agent earns commission points and withdraws
  directly, so nobody is enrolled into an earning relationship by someone else filling in a
  form. Invitation, then acceptance — the same shape as a host joining.
- **A seat is per person and outlives any one agency.** `agents.user_id` is unique, which is
  what keeps "which agency is this agent in" a question with one answer. Someone removed and
  later invited elsewhere revives their row and keeps the Agent ID hosts already wrote down;
  the dated assignment records the move.
- **Removing an agent moves their hosts to the OWNER.** They joined an agency, not a person,
  and dropping them would stop their earnings through no act of their own. Each dated link is
  closed and a new one opened at the same instant — permitted by the no-overlap constraint
  precisely because the ranges touch rather than overlap — so a host moved on the 14th has
  the first half of the month still attributed to the agent who actually held them. This is
  the case the dated links were built for.
- **Suspension is blunt and deliberate.** `agentSeat` requires an ACTIVE agency, so a
  suspended one loses coin trading, host recruitment and agent management in one move. It
  does NOT touch the inventory (paid for, settled off-platform) or the hosts (who keep
  earning — they joined an agency, not its conduct). Every change is recorded in
  `agency_status_changes` rather than overwriting the last reason. `closed` is final.

### M12 commission · migration 024

Built 2026-10-05. The engine the levels and the tree were always for.

**One deviation from the design above, deliberate.** The doc writes an attribution row per
gift; this derives them at period close from `gift_sends` joined to the two dated links by
gift timestamp. Same record, same audit trail, three gains: the gift hot path is untouched
(gifting is the one endpoint that must never slow down), an attribution cannot be *missing*
because it is derived rather than remembered, and a gift reversed while the period is still
open simply never becomes one — which is what the doc's own reversal rule asks for.

How a period runs:

1. **Opening** writes every payee's rate from the PREVIOUS period's volume, with the
   one-step-per-period floor applied and recorded (`cushioned`). A new agency starts at D.
   A sub-agent's rate is capped at their agency's, which matters only when the agency
   slipped while the sub-agent climbed — without it the agency's differential goes negative
   and it would owe money on its own team's work.
2. **Closing** derives the attributions, aggregates per agent and per agency, and posts
   **one transaction per payee**, keyed `commission:{period}:{type}:{id}` — derived from the
   close, never a client header, so a resumed close credits once.
3. **The split:** a sub-agent earns their own hosts at their own rate; the agency earns the
   differential on those plus the full rate on hosts the owner's seat holds directly. The
   total is always `team points × the agency's rate`. The owner's seat earns nothing
   separately — that would pay twice for the same work. There is a test asserting the two
   halves sum to exactly the agency's rate on the whole team.
4. **Points land in `_held`.** A chargeback can still arrive after a period closes, which is
   what the hold window is for. Release to withdrawable is M8's, covering all three account
   types.
5. The in-house agency is skipped entirely, and gifts to a host in no agency produce no
   attribution.

The close job runs **daily at 05:00 IST**, not monthly: a monthly cron that misses its one
firing leaves a month unpaid until an agency asks. It closes whatever has ended and is still
open, so a missed day costs nothing. It pages on failure — an unpaid period is a bill the
platform owes and has not written down. Deliberately not at 03:00 with reconciliation, so
the night's checks never see a half-written period.

**Still open:** the closed-period half of the reversal rule. A gift reversed AFTER its period
closed should post a negative accrual in the current period; today it is simply left behind.
Nothing posts gift reversals yet, so there is no live gap — build it with M8's clawback path.

### C28 · Points → coins exchange

A host (or agency) turns earned points back into coins to spend on gifts. Decided
2026-09-27; the competitor surfaces it as "Exchange Points for Coins" beside Withdraw.

**Why it is worth building: it is the cheapest liability we can offer.** Points worth ₹100
are a ₹100 cash obligation. Exchanged into coins they become coin float, and when those
coins are gifted only ~30% comes back as a new point obligation. Every ₹100 exchanged
instead of withdrawn turns a ₹100 cash payout into roughly ₹30 of future liability — and
the host stays inside the economy instead of taking money out of it.

**Rate.** One point is worth exactly **half a coin** at accounting face value — the same
invariant that makes an advertised 60% split a real 30% payout. So the neutral exchange is
`coins = points ÷ 2`, and at that rate the paise legs balance with no gain or loss to book.
A **bonus is affordable and is a config dial** (`point_to_coin_bonus_bp`, seeded 0 by
migration 020 — launch at parity, founder 2026-10-05): even
at +20% the exchange still costs far less than paying the cash.

**Legs** — 1,000 points exchanged at parity into 500 coins (₹3.85 of value at 260 points/₹
and 130 coin-units/₹):

```
point   host:{h}:points_withdrawable    −1,000
        system:point_float              +1,000        → 0 ✓

coin    user:{h}:coins                    +500
        system:coin_float                 −500        → 0 ✓

paise   liability:points_payable          +385        (cash obligation released)
        liability:deferred_revenue        −385        (coin float takes its place)
                                                      → 0 ✓
```

With a bonus the extra coins are minted the way the coins→gems bonus is: the difference
goes to a contra-revenue account, never to thin air.

**Rules.**

- **Withdrawable points only.** Held and pending-payout points are inside the risk window —
  the whole point of the hold is that the earning might still be reversed.
- **One way, forever.** Coins never become points. The reverse would be a cash-out route
  around KYC and the hold period, and it would let bought coins be turned into a
  withdrawable balance — which is money laundering with extra steps.
- **No TDS at exchange**, because no payment leaves. The income arose when the points were
  credited; this is the host spending it. Worth one line to the CA, since taking value in
  kind rather than cash is exactly the sort of thing they will want to have an opinion on.
- **No new laundering surface.** A round trip destroys value fast — coins gifted return only
  60% of their count as points, each worth half a coin — so there is nothing to farm, and
  cash still leaves only through a KYC'd withdrawal.

### The payout flow — host, agent, agency

Settled 2026-09-27, and it **overturns one earlier note**: the platform pays each party
directly — host, sub-agent and agency — rather than paying the agency and leaving it to
settle its own people. An agency that never handles anyone else's money is further from
being a payment aggregator, not closer, and each payee is then our own service provider.
Cost is unchanged: the total is set by the top agency's rate, and the split only decides
who receives it.

Six things the obvious version of this flow gets wrong:

1. **Tax is a step, not a detail.** Between approval and payment: compute withholding from
   a rate strategy (section and rate in config, pending the CA), write the net to the bank
   and the withheld amount to `tds_payable`, and bump a per-payee, per-financial-year total.
   Crossing the yearly threshold withholds on **everything paid that year so far**, not the
   excess. Hosts and agencies sit under different sections, so two strategies.

2. **Commission cannot be final at gift time.** Per gift, write only an ATTRIBUTION row —
   host, agent, agency, eligible earning, gift timestamp, no rate and no money. At period
   close a job resolves each party's rate and posts **one commission transaction per payee
   per period**. That is what makes "recalculated monthly, never retroactive" literal, and
   the attribution row is what survives a host moving between agents. *(If the rate for a
   period is set by the PREVIOUS period's volume — see the open decision below — the rate is
   known in advance and no true-up is ever needed.)*

3. **A reversal never edits a closed period.** Every derived record points at its source
   gift. Period still open: drop the attribution row from the running sum, since no
   commission exists yet. Period closed and paid: post a negative accrual in the CURRENT
   period that nets against what the payee is about to earn.
   *Policy, still to confirm:* an agency keeps commission on a charged-back gift (the
   platform bears that loss per C23, and the agency did its job) but not on one reversed for
   fraud or ban forfeiture, where the earning was never real.

4. **Approval is its own state.** One person assembles a batch, a DIFFERENT person approves
   it, and the database refuses both being the same user. Below a configurable amount,
   auto-approve so a small host withdrawal does not wait on a human.

5. **Agent↔agency moves need the same dated link as host↔agent.**
   `agent_agency_assignments(agent, agency, effective_from, effective_to)`. Resolution walks
   gift timestamp → the host's agent then → that agent's agency then. Two dated lookups, and
   history is never touched.

6. **A direct host is not a special case.** The agency owner holds an agent row of their own
   (`agencies.owner_agent_id`), so a host attached "directly to the agency" is simply a host
   assigned to that agent. Every host has an agent; every agent has an agency.

**Everyone earns POINTS, and withdraws points** (founder, 2026-09-27). Commission is not a
rupee payable: an agency and a sub-agent hold a point balance exactly as a host does, with
one Withdraw button and one payout pipeline behind it. This overturns the `paise` commission
accounts sketched in A4 — `agency_commission_payable` and `expense:agency_commission` stay
for the rupee side of the payout itself, but the entitlement now lands in points.

Three things that follow:

- **Scoped point accounts for agencies and agents.** `ledger_accounts.scope_type` gains
  `agency` and `agent` alongside `user`, `host` and `system`, each with `points_held` /
  `points_withdrawable` / `points_pending_payout`. `system:point_float` then mirrors host,
  agent AND agency balances, and reconciliation check E-points covers all three.
- **The agency owner is paid in points too** (founder, 2026-09-28). The agency's commission
  lands in `agency_points_*`, which the owner redeems like anyone else — there is no direct
  rupee payment to any party. The owner's own agent seat earns nothing separately; the
  owner's hosts count in the agency's team.
- **The unit of the balance does not change the tax.** A payout is still rupees leaving a
  bank account, and an agency is still supplying us a service — so GST and TDS under 194H
  apply to the agency's payout, and the host's sits under its own section. The point→rupee
  conversion is frozen on the payout transaction (§ G1), so a later retune of the point rate
  never rewrites what was paid.
- **The minimum and the ladder.**

| | Minimum | Steps |
|---|---|---|
| Host | ₹1,000 (≈ $10) | ₹1,000 (≈ $10) |
| Agency / sub-agent | ₹2,000 (≈ $20) | ₹1,000 (≈ $10) |

Confirmed by the founder 2026-09-28 as "$10 for hosts, $20 for agencies and sub-agents,
multiples of $10", redeemed in-app through the payout methods offered. Stored in
`app_config.withdrawals`.

Withdrawals are whole steps only — ₹1,000, ₹2,000, ₹3,000 — never ₹1,250 or ₹3,811. Defined
in **rupees, not dollars**: the app may display a dollar figure, but a dollar-denominated
floor drifts with the exchange rate and would quietly move every payout threshold. The
ladder converts to points exactly at the point rate, so no rounding residue is ever created.

A remainder therefore always stays in the balance — someone holding ₹10,500 withdraws
₹10,000 and keeps ₹500. The screen has to say so plainly, or it reads as money going
missing.

**The commission RATE comes from a LEVEL** — **D / C / B / A / S** (founder, 2026-09-28;
replaces the nine-level table of 2026-09-27). A level is a range of team points earned in a
period, and it carries a rate:

| Level | Team points in the period | Rate |
|---|---|---|
| D | up to 2,000,000 (≈ ₹7.7K of team earnings) | 4% |
| C | 2M – 10M (≈ ₹38K) | 8% |
| B | 10M – 50M (≈ ₹1.9L) | 12% |
| A | 50M – 150M (≈ ₹5.8L) | 16% |
| S | 150M and above | 20% |

The rates are the founder's. The bands were retuned in migration 020 (founder accepted the
recommendation, 2026-10-05) so that **C is within reach of an agency with 5–10 active hosts
in its first months** — an agency stuck at D leaves. Still starting values: check them
against real team volumes ~3 months after launch. Rates in basis points and bands in points,
in `app_config.commission_levels`.

**The in-house agency earns no commission.** `agencies.is_house` marks the single agency we
own for platform-seeded hosts; the commission engine must skip it. Its hosts are paid like
any other host.

The rules around it:

- **Bands are counted in POINTS, not rupees.** A rupee band would move every agency's level
  silently the next time the point rate is retuned. The corollary: a retune must rescale the
  bands with it — doubling the point rate doubles every band, or every agency drops a level
  overnight for no reason.
- **The previous period sets this period's rate.** October's team total fixes the rate that
  applies to every gift in November, so the rate is known before the period starts, every
  gift is priced the moment it lands, and no true-up or retroactive repricing ever happens
  (§ G1, and "never retroactive"). The cost is a one-period lag on a breakout month — which
  also protects a bad one. Shorten the period before ever making it retroactive.
- **A level may fall, but by at most one step per period.** Rates that only ratchet up are
  not a ladder; a single bad month that erases a year's progress loses the agency.
- **A new agency starts at level D** and has no previous period to be measured on.
- **An agency's level counts its whole team**, sub-agents and direct hosts alike. A
  sub-agent's own level counts only their own hosts.
- **A sub-agent's rate is capped at their agency's.** Team volume normally makes the
  agency's level the higher of the two automatically; the cap matters in the one case where
  it does not — the agency slipped a step while the sub-agent climbed one — and without it
  the agency's differential goes negative and it would owe money on its own team's work.
- **The rate is shown in the app** on the agency's and the sub-agent's own page, alongside
  progress towards the level they are currently earning for the next period. With the rate
  fixed in advance there is a real number to show, and an agency can tell a sub-agent what
  they will earn without guessing.


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
| G1 | **Rate immutability** — a gift's `payout_rate` and the coin/point rates used must be stored **on the txn**, so a later price change never retroactively reinterprets history | **[D]** stored on the txn (`rates` jsonb), and the unit price and rate are ALSO copied onto `gift_sends`. The send carries the price the client displayed; a mismatch is refused (`GIFT_PRICE_CHANGED`) rather than charged at a price the user never saw. |
| G2 | Kill-switch interaction — what happens to in-flight transactions when gifting is disabled | **[D]** `is_active` is read INSIDE the posting transaction. Anything that has already passed that read commits normally; everything after it gets `503 TXN_TYPE_INACTIVE`. No transaction is ever half-applied or rolled back by the switch. The client flag `giftingEnabled` hides the button, but the ledger check is what actually stops money. |
| G3 | Admin read access + audit log (who viewed, who adjusted) | [?] |
| G4 | Test strategy — property test (sum always zero), concurrency test (parallel gifts, no deadlock, no double-spend), replay test (idempotency) | [?] |
| G5 | Seeding / fixtures for local dev and the Postman collection | [?] |

## H. Policy calls that change the schema

| # | Item | Status |
|---|---|---|
| H1 | Multi-currency ever, or INR-only forever? Affects whether `paise` is a unit or a currency+amount pair | [?] |
| H2 | Can any balance go negative, under any circumstance? | [?] |
| H3 | Do resellers and agencies get real ledger accounts, or are they tracked outside the ledger? | **[D]** real accounts — `reseller:{id}:inventory` in the `coin` unit, tracked and non-negative. The non-negative constraint IS hard rule #3: an agency cannot transfer coins it has not paid for, enforced by the database rather than by a policy someone has to remember. |
| H4 | Is the gift `quantity`/combo a first-class ledger concept or purely an event property? | [?] |
| H5 | Does the ledger record the *channel* (iap/web/reseller) per purchase, for the channel-mix dial? | **[D]** yes — three separate `asset:cash:*` accounts, so channel mix is a balance read |
