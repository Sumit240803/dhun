-- ============================================================================
-- 002 · The double-entry ledger — the financial source of truth
--
-- Design is fixed by backend/docs/ledger-decisions.md, Sections A and B.
-- Read that before changing anything here.
--
-- Core invariants:
--   1. Entries are append-only. Never UPDATE, never DELETE — post a
--      compensating transaction instead.
--   2. Every transaction's entries sum to ZERO, per unit. Enforced by a
--      deferred constraint trigger, so an unbalanced txn cannot commit.
--   3. Balances are DERIVED. account_balances is a cache maintained inside the
--      same transaction; the nightly job verifies it against SUM(entries).
--   4. Three units: coin, point, paise. Gems are an ACCOUNT in the coin unit,
--      not a unit of their own — 1 gem = 1 coin in value.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ledger_txn_types · lookup, not an enum, so adding a type is an INSERT
--
-- is_active doubles as the money-layer kill switch required by the day-1
-- non-negotiables: flip gift_send inactive and gifting stops atomically,
-- with no deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE ledger_txn_types (
  code                   text PRIMARY KEY,
  category               text NOT NULL CHECK (category IN
                           ('coins_in','coins_out','host_feature','points','agency','payout','correction')),
  phase                  smallint NOT NULL DEFAULT 0,     -- 0 = MVP, 1/2 = later
  units_touched          text[] NOT NULL,
  requires_maker_checker boolean NOT NULL DEFAULT false,
  reversible             boolean NOT NULL DEFAULT true,
  is_active              boolean NOT NULL DEFAULT true,   -- kill switch
  description            text NOT NULL
);

INSERT INTO ledger_txn_types
  (code, category, phase, units_touched, requires_maker_checker, reversible, is_active, description) VALUES
  -- coins in ---------------------------------------------------------------
  ('purchase_iap',              'coins_in',     0, ARRAY['coin','paise'], false, true,  true,  'Coin pack bought through Play / App Store'),
  ('purchase_web',              'coins_in',     0, ARRAY['coin','paise'], false, true,  true,  'Coin pack bought through the web portal'),
  ('purchase_reseller',         'coins_in',     1, ARRAY['coin','paise'], false, true,  false, 'User receives coins from a reseller'),
  ('reseller_prepay',           'coins_in',     1, ARRAY['coin','paise'], true,  true,  false, 'Reseller buys coins in bulk, paid up front — NEVER on credit'),
  ('free_coin_grant',           'coins_in',     0, ARRAY['coin','paise'], false, true,  true,  'Free coins: signup, check-in, watch, follow, share, referral, daily spin'),
  ('promo_grant',               'coins_in',     0, ARRAY['coin','paise'], false, true,  true,  'Campaign or festival giveaway — kept separate so campaign cost is measurable'),
  ('admin_credit',              'coins_in',     0, ARRAY['coin','paise'], true,  true,  true,  'Manual credit / support goodwill'),

  -- coins & gems out -------------------------------------------------------
  ('gift_send',                 'coins_out',    0, ARRAY['coin','point','paise'], false, true, true, 'Gift sent to a host'),
  ('cosmetic_purchase',         'coins_out',    0, ARRAY['coin','paise'], false, true,  true,  'Cosmetic bought with gems — ZERO host payout'),
  ('cosmetic_grant',            'coins_out',    0, ARRAY['coin','paise'], false, true,  true,  'Free cosmetic unlocked by user level (16-30 effect, 31-50 frame)'),
  ('vip_purchase',              'coins_out',    1, ARRAY['coin','paise'], false, true,  false, 'VIP tier bought with gems'),
  ('vip_renewal',               'coins_out',    1, ARRAY['coin','paise'], false, true,  false, 'Monthly VIP renewal'),
  ('vip_refund',                'coins_out',    1, ARRAY['coin','paise'], true,  false, false, 'VIP cancelled mid-cycle — only if that policy is adopted'),
  ('coin_to_gem_conversion',    'coins_out',    0, ARRAY['coin','paise'], false, true,  true,  'Coins converted to gems, one-way, +20%'),
  ('admin_debit',               'coins_out',    0, ARRAY['coin','paise'], true,  true,  true,  'Manual debit / correction'),

  -- host-earning features (Phase 1-2) --------------------------------------
  ('fan_club_join',             'host_feature', 1, ARRAY['coin','point','paise'], false, true, false, 'Paid fan club join — host earns'),
  ('fan_club_renewal',          'host_feature', 1, ARRAY['coin','point','paise'], false, true, false, 'Fan club renewal'),
  ('private_call_charge',       'host_feature', 1, ARRAY['coin','point','paise'], false, true, false, 'Private 1-on-1 call, charged per minute'),
  ('room_entry_fee',            'host_feature', 2, ARRAY['coin','point','paise'], false, true, false, 'Paid-entry room'),
  ('guardian_slot_purchase',    'host_feature', 2, ARRAY['coin','point','paise'], false, true, false, 'Guardian slot'),

  -- points lifecycle -------------------------------------------------------
  ('points_hold_release',       'points',       0, ARRAY['point'], false, false, true, 'Held points become withdrawable after 7 days (14 for new hosts)'),
  ('host_referral_bonus',       'points',       0, ARRAY['point','paise'], false, true, true, 'Extra 10% points for 3 months on gifts from a host-referred user'),
  ('host_guarantee_topup',      'points',       0, ARRAY['point','paise'], true,  true, true, 'Seeding guarantee top-up — "guaranteed minimum earning", never "salary"'),

  -- agency -----------------------------------------------------------------
  ('agency_commission_accrual', 'agency',       0, ARRAY['paise'], false, true, true, 'Commission accrued on trailing-30d host earnings, split by GIFT timestamp'),
  ('agency_commission_payout',  'agency',       0, ARRAY['paise'], true,  true, true, 'Commission paid to the agency. NEVER to a sub-agent — see hard rule #2'),
  ('agency_incentive_payout',   'agency',       0, ARRAY['paise'], true,  true, true, 'Launch milestone incentive, outside the commission tiers'),

  -- payouts ----------------------------------------------------------------
  ('payout_request',            'payout',       0, ARRAY['point'], false, true,  true, 'Withdrawable points move to pending'),
  ('payout_settled',            'payout',       0, ARRAY['point','paise'], true, true, true, 'Paid to bank, net of TDS'),
  ('payout_failed',             'payout',       0, ARRAY['point','paise'], false, false, true, 'Bank rejected — points return to withdrawable'),
  ('payout_rejected',           'payout',       0, ARRAY['point'], true,  false, true, 'Approver rejected the batch'),
  ('payout_cancelled',          'payout',       0, ARRAY['point'], false, false, true, 'Host cancelled their own request'),
  ('payout_clawback',           'payout',       0, ARRAY['point','paise'], true, false, true, 'Recovering a duplicate payout caused by a bug'),
  ('tds_withheld',              'payout',       0, ARRAY['paise'], false, true,  true, 'TDS withheld. Crossing the threshold applies it to the FULL year amount'),
  ('gst_added',                 'payout',       0, ARRAY['paise'], false, true,  true, 'GST-registered host: +18% added, self-billing invoice'),

  -- corrections & losses ---------------------------------------------------
  ('chargeback',                'correction',   0, ARRAY['coin','paise'], true, false, true, 'User charged back. Platform bears the loss — NEVER claw back from the host'),
  ('refund',                    'correction',   0, ARRAY['coin','paise'], true, false, true, 'Purchase refunded'),
  ('ban_forfeiture',            'correction',   0, ARRAY['coin','point','paise'], true, false, true, 'L1 ban forfeits balance. L2/L3 keep payout rights'),
  ('abandonment_forfeiture',    'correction',   0, ARRAY['coin','point','paise'], true, false, true, 'Inactive 12 months notified, forfeited at 24');


-- ---------------------------------------------------------------------------
-- ledger_accounts
--
-- bigserial, not uuid: never exposed in an API, and ascending integer ids give
-- the canonical lock ordering that prevents deadlock (Section B4).
--
-- allow_negative is false for user/host accounts and true for system accounts,
-- which are the counterparties and therefore run negative by design.
-- ---------------------------------------------------------------------------
CREATE TABLE ledger_accounts (
  id             bigserial PRIMARY KEY,
  code           text NOT NULL,
  account_type   text NOT NULL CHECK (account_type IN
                   ('asset','liability','revenue','expense','contra_revenue','contra_liability')),
  scope_type     text NOT NULL CHECK (scope_type IN ('user','host','system')),
  scope_id       uuid,                    -- NULL for system accounts
  unit           text NOT NULL CHECK (unit IN ('coin','point','paise')),
  allow_negative boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_scope_id_matches_type
    CHECK ((scope_type = 'system' AND scope_id IS NULL)
        OR (scope_type <> 'system' AND scope_id IS NOT NULL))
);

-- NULLS NOT DISTINCT so the single system row per code is genuinely unique
-- (plain UNIQUE treats every NULL scope_id as different). Requires PG15+.
CREATE UNIQUE INDEX uq_ledger_account
  ON ledger_accounts (code, scope_id) NULLS NOT DISTINCT;

CREATE INDEX idx_ledger_accounts_scope ON ledger_accounts (scope_type, scope_id);


-- ---------------------------------------------------------------------------
-- account_balances · the cache
--
-- Rows exist ONLY for user and host accounts. System accounts deliberately
-- have no cached balance: every transaction touches system_coin_float, so a
-- cached row there would serialise the entire platform on one page (B4).
-- They are computed from entries by the nightly reconciliation instead.
--
-- Because every row here is a non-negative account, the CHECK is unconditional.
-- ---------------------------------------------------------------------------
CREATE TABLE account_balances (
  account_id bigint PRIMARY KEY REFERENCES ledger_accounts(id),
  balance    bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- ledger_txns
--
-- One row per money operation. The idempotency key lives HERE, not on entries.
--
-- rates is frozen at write time (coin_rate, point_rate, payout_rate_bp). The
-- economy docs plan to retune all three about three months after launch; without
-- this, one config change would silently rewrite the meaning of every historical
-- entry and break every reconciliation check.
-- ---------------------------------------------------------------------------
CREATE TABLE ledger_txns (
  id               uuid PRIMARY KEY,
  txn_type         text NOT NULL REFERENCES ledger_txn_types(code),
  idempotency_key  text NOT NULL UNIQUE,
  identity         jsonb NOT NULL,          -- operation identity, for strict replay
  request_hash     text,                    -- optional secondary check
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','completed','failed')),
  response_body    jsonb,                   -- replayed verbatim; purged after 7 days
  rates            jsonb NOT NULL,          -- frozen rates — see above
  actor_user_id    uuid REFERENCES users(id),
  reverses_txn_id  uuid REFERENCES ledger_txns(id),
  memo             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,

  -- One level of reversal only: correct the original, never reverse a reversal.
  CONSTRAINT txn_not_self_reversing CHECK (reverses_txn_id IS DISTINCT FROM id)
);

CREATE INDEX idx_txns_type_created ON ledger_txns (txn_type, created_at DESC);
CREATE INDEX idx_txns_actor ON ledger_txns (actor_user_id, created_at DESC);
CREATE INDEX idx_txns_reverses ON ledger_txns (reverses_txn_id) WHERE reverses_txn_id IS NOT NULL;
-- Drives the response_body purge job.
CREATE INDEX idx_txns_purgeable ON ledger_txns (created_at) WHERE response_body IS NOT NULL;


-- ---------------------------------------------------------------------------
-- ledger_entries · append-only, the actual source of truth
--
-- NOT partitioned yet — see the note at the bottom of this file.
-- ---------------------------------------------------------------------------
CREATE TABLE ledger_entries (
  id         bigserial PRIMARY KEY,
  txn_id     uuid   NOT NULL REFERENCES ledger_txns(id),
  account_id bigint NOT NULL REFERENCES ledger_accounts(id),
  unit       text   NOT NULL CHECK (unit IN ('coin','point','paise')),
  amount     bigint NOT NULL CHECK (amount <> 0),   -- signed; a zero leg is a bug
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Account statement, newest first.
CREATE INDEX idx_entries_account ON ledger_entries (account_id, id DESC);
-- Fetching all legs of one transaction; also used by the balance check below.
CREATE INDEX idx_entries_txn ON ledger_entries (txn_id);
-- Nightly reconciliation windows.
CREATE INDEX idx_entries_created ON ledger_entries (created_at);


-- ---------------------------------------------------------------------------
-- Invariant 1 · entries are immutable
--
-- Belt and braces: this trigger catches application bugs in ANY role. Staging
-- and production additionally REVOKE UPDATE, DELETE from the app role, which
-- catches console mistakes and injection. See ops/roles.sql.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries is append-only (attempted % on entry %). Post a compensating transaction instead.',
    TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();


-- ---------------------------------------------------------------------------
-- Invariant 2 · every transaction balances, per unit
--
-- DEFERRABLE INITIALLY DEFERRED, so it runs at COMMIT — by which time all legs
-- are present. This makes an unbalanced transaction impossible rather than
-- merely detectable the next morning.
--
-- It fires once per inserted row (constraint triggers must be FOR EACH ROW), so
-- an 8-leg gift runs 8 identical checks over 8 indexed rows. Measurably free.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_txn_balanced() RETURNS trigger AS $$
DECLARE
  offending record;
BEGIN
  SELECT e.unit, SUM(e.amount) AS total
    INTO offending
    FROM ledger_entries e
   WHERE e.txn_id = NEW.txn_id
   GROUP BY e.unit
  HAVING SUM(e.amount) <> 0
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'unbalanced ledger transaction %: unit "%" sums to % (must be 0)',
      NEW.txn_id, offending.unit, offending.total;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_txn_balanced();


-- ---------------------------------------------------------------------------
-- outbox · the durable event path
--
-- Written inside the same transaction as the ledger entries. Without that, a
-- crash between COMMIT and publish loses the event and analytics drift forever.
--
-- The live UI does NOT read from here — gift animations go straight to Redis
-- pub/sub after commit, so they never wait on the shipper.
-- ---------------------------------------------------------------------------
CREATE TABLE outbox (
  id            bigserial PRIMARY KEY,
  event_id      uuid NOT NULL UNIQUE,     -- stable; consumers dedupe on this
  event_type    text NOT NULL,            -- object_action, past tense
  partition_key text NOT NULL,            -- ordering is per key, never global
  payload       jsonb NOT NULL,
  txn_id        uuid REFERENCES ledger_txns(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  attempts      smallint NOT NULL DEFAULT 0,
  last_error    text
);

-- The shipper's only query: unpublished, oldest first.
CREATE INDEX idx_outbox_unpublished ON outbox (id) WHERE published_at IS NULL;
CREATE INDEX idx_outbox_txn ON outbox (txn_id) WHERE txn_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- System accounts · seeded once, referenced forever
-- ---------------------------------------------------------------------------
INSERT INTO ledger_accounts (code, account_type, scope_type, scope_id, unit, allow_negative) VALUES
  -- coin unit: the counterparty to every user coin and gem balance
  ('system_coin_float',           'contra_liability', 'system', NULL, 'coin',  true),
  -- point unit: the counterparty to every host point balance
  ('system_point_float',          'contra_liability', 'system', NULL, 'point', true),

  -- paise · assets. Three cash accounts give the channel-mix dial as a balance read.
  ('cash_iap',                    'asset',            'system', NULL, 'paise', true),
  ('cash_web',                    'asset',            'system', NULL, 'paise', true),
  ('cash_reseller',               'asset',            'system', NULL, 'paise', true),
  ('bank',                        'asset',            'system', NULL, 'paise', true),

  -- paise · liabilities
  ('deferred_revenue',            'liability',        'system', NULL, 'paise', true),
  ('points_payable',              'liability',        'system', NULL, 'paise', true),
  ('tds_payable',                 'liability',        'system', NULL, 'paise', true),
  ('agency_commission_payable',   'liability',        'system', NULL, 'paise', true),

  -- paise · revenue. The 75-80 / 20-25 spend split reads straight off these two.
  ('revenue_gifting',             'revenue',          'system', NULL, 'paise', true),
  ('revenue_cosmetics',           'revenue',          'system', NULL, 'paise', true),

  -- paise · contra-revenue. Keeps every unit worth exactly 1/65 of a rupee.
  ('discount_pack',               'contra_revenue',   'system', NULL, 'paise', true),
  ('discount_conversion_bonus',   'contra_revenue',   'system', NULL, 'paise', true),
  ('discount_reseller',           'contra_revenue',   'system', NULL, 'paise', true),

  -- paise · expenses
  ('expense_host_payout',         'expense',          'system', NULL, 'paise', true),
  ('expense_free_coins',          'expense',          'system', NULL, 'paise', true),
  ('expense_agency_commission',   'expense',          'system', NULL, 'paise', true),
  ('expense_chargeback',          'expense',          'system', NULL, 'paise', true),
  ('expense_host_guarantee',      'expense',          'system', NULL, 'paise', true),
  ('expense_payout_fees',         'expense',          'system', NULL, 'paise', true);


-- ============================================================================
-- DEFERRED: partitioning ledger_entries
--
-- Section F3 called for monthly RANGE partitions from day one. Holding off until
-- a dedicated migration before soft launch, for one reason: PostgreSQL restricts
-- CONSTRAINT TRIGGERs on partitioned tables, and the balanced-transaction
-- guarantee above matters more than partitioning does at beta volume (~500
-- users). Taking on an unverified feature interaction in the foundation
-- migration is the wrong trade.
--
-- When it lands, the trigger attaches per-partition via the partition-creation
-- function rather than to the parent. Do it while the table is still small.
-- ============================================================================
