-- ---------------------------------------------------------------------------
-- 019 · Agencies, agents, and the coin reseller channel (M12)
--
-- Decisions: CLAUDE.md "Roles — host, agent, agency", backend/docs/
-- ledger-decisions.md § C3 / C4 and § M12 schema. Hard rules #2, #3 and #7 are
-- each enforced somewhere in this file; the comments say where.
--
-- The shape:
--
--   agency ──< agent_agency_assignments >── agent ──< host_agent_assignments >── host
--
-- Both links are DATED rather than a mutable column, so a host who moves agent
-- mid-month has each gift attributed by its timestamp, never by wherever they
-- sit on payout day. The host→agency link is derived from the two.
--
-- Money does NOT flow down that tree. Host, sub-agent and agency each earn
-- points in their own accounts and withdraw directly; nobody is paid through
-- anybody else (hard rule #2).
-- ---------------------------------------------------------------------------

-- Needed for the no-overlap EXCLUDE constraints on the dated links. Ships with
-- Postgres contrib and is allowed on every managed provider we would use.
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ---------------------------------------------------------------------------
-- agencies
--
-- Created by an ADMIN, never in the app. Registration is an email to the
-- official address, a conversation, then manual onboarding — so there is no
-- application table and no approval queue. The row IS the approval.
--
-- owner_agent_id is filled in the same transaction the agency is created in
-- (the owner holds an agent seat like anyone else), hence the deferred FK.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE agency_public_id_seq START 700001;

CREATE TABLE agencies (
  id                      uuid PRIMARY KEY,
  -- What an agency is called by in support and on its invite link. Separate
  -- range from user ids so the two are never confused on a phone call.
  public_id               bigint NOT NULL UNIQUE DEFAULT nextval('agency_public_id_seq'),
  name                    text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  owner_user_id           uuid NOT NULL REFERENCES users(id),
  owner_agent_id          uuid,                       -- FK added below, deferred
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended', 'closed')),
  contact_email           text CHECK (contact_email IS NULL OR length(contact_email) <= 254),
  -- Coin trading is a SEPARATE grant: buying inventory is where fraud and
  -- laundering land, and an agency that only manages hosts must not be able to
  -- move currency by default.
  coin_trading_enabled_at timestamptz,
  coin_trading_enabled_by uuid REFERENCES users(id),
  created_by              uuid NOT NULL REFERENCES users(id),   -- the admin
  suspended_reason        text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agency_trading_grant_complete
    CHECK ((coin_trading_enabled_at IS NULL) = (coin_trading_enabled_by IS NULL))
);

-- One agency per owner. A person running two agencies is two sets of books and
-- the commission-level gaming that comes with them.
CREATE UNIQUE INDEX uq_agency_owner ON agencies (owner_user_id) WHERE status <> 'closed';

CREATE TRIGGER agencies_updated_at BEFORE UPDATE ON agencies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- agents · a user's seat inside the agency tree
--
-- One per user, whichever agency they are in today (that is the dated link's
-- job). The agency owner holds one too, so a host attached "directly to the
-- agency" is just a host of the owner's agent — no special case anywhere.
--
-- can_manage_agents is the per-account grant that separates a main agent from
-- a sub-agent. A grant, not a second role name, so an agency can let one
-- trusted sub-agent recruit agents without inventing a tier.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE agent_public_id_seq START 80000001;

CREATE TABLE agents (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL UNIQUE REFERENCES users(id),
  -- The Agent ID a host types to join. Enumerable by design and harmless: a
  -- request made with it still needs the agent to accept.
  public_id          bigint NOT NULL UNIQUE DEFAULT nextval('agent_public_id_seq'),
  can_manage_agents  boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'suspended', 'removed')),
  created_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE agencies
  ADD CONSTRAINT fk_agency_owner_agent
  FOREIGN KEY (owner_agent_id) REFERENCES agents(id)
  DEFERRABLE INITIALLY DEFERRED;


-- ---------------------------------------------------------------------------
-- The dated links
--
-- effective_to NULL = current. Periods for one agent (or one host) may never
-- overlap — enforced by EXCLUDE, not by application code, because an overlap
-- would attribute one gift to two agencies and pay commission twice.
-- Rows are closed by setting effective_to, never deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE agent_agency_assignments (
  id              uuid PRIMARY KEY,
  agent_id        uuid NOT NULL REFERENCES agents(id),
  agency_id       uuid NOT NULL REFERENCES agencies(id),
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_by      uuid NOT NULL REFERENCES users(id),
  ended_by        uuid REFERENCES users(id),
  end_reason      text CHECK (end_reason IS NULL OR length(end_reason) <= 500),

  CONSTRAINT agent_assignment_period_valid
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT agent_assignment_no_overlap
    EXCLUDE USING gist (agent_id WITH =,
                        tstzrange(effective_from, effective_to, '[)') WITH &&)
);

CREATE INDEX idx_agent_assignments_agency
  ON agent_agency_assignments (agency_id, effective_from DESC);

CREATE TABLE host_agent_assignments (
  id              uuid PRIMARY KEY,
  host_user_id    uuid NOT NULL REFERENCES users(id),
  agent_id        uuid NOT NULL REFERENCES agents(id),
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  -- The consent that created it. Both routes need both sides to agree.
  join_request_id uuid,                               -- FK added below
  ended_by        uuid REFERENCES users(id),
  end_reason      text CHECK (end_reason IS NULL OR length(end_reason) <= 500),

  CONSTRAINT host_assignment_period_valid
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT host_assignment_no_overlap
    EXCLUDE USING gist (host_user_id WITH =,
                        tstzrange(effective_from, effective_to, '[)') WITH &&)
);

CREATE INDEX idx_host_assignments_agent
  ON host_agent_assignments (agent_id, effective_from DESC);


-- ---------------------------------------------------------------------------
-- host_join_codes · the second factor on an agent's invite
--
-- User public ids are sequential 8-digit numbers. Without a second factor an
-- agent could invite every user on the platform by typing numbers in order.
-- The host shows this code to an agent they WANT to join; rotating it revokes
-- every copy they have handed out.
-- ---------------------------------------------------------------------------
CREATE TABLE host_join_codes (
  user_id     uuid PRIMARY KEY REFERENCES users(id),
  code        text NOT NULL CHECK (code ~ '^[A-Z2-9]{6}$'),   -- no 0/O/1/I
  rotated_at  timestamptz NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- agency_join_requests · consent from both sides
--
--   host_applied   the host typed an Agent ID (or followed an agency invite
--                  link, which is this route with the id pre-filled); the
--                  agent accepts or declines.
--   agent_invited  the agent entered the host's User ID + Host Code; the host
--                  accepts or declines.
--
-- Accepting opens a host_agent_assignments row in the same transaction.
-- ---------------------------------------------------------------------------
CREATE TABLE agency_join_requests (
  id              uuid PRIMARY KEY,
  host_user_id    uuid NOT NULL REFERENCES users(id),
  agent_id        uuid NOT NULL REFERENCES agents(id),
  direction       text NOT NULL CHECK (direction IN ('host_applied', 'agent_invited')),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  message         text CHECK (message IS NULL OR length(message) <= 300),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  decided_at      timestamptz,
  decided_by      uuid REFERENCES users(id),

  CONSTRAINT join_request_decision_complete
    CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT join_request_expiry_valid CHECK (expires_at > created_at)
);

-- One live request per pair, whichever side started it.
CREATE UNIQUE INDEX uq_join_request_pending
  ON agency_join_requests (host_user_id, agent_id) WHERE status = 'pending';
CREATE INDEX idx_join_requests_agent
  ON agency_join_requests (agent_id, created_at DESC) WHERE status = 'pending';
CREATE INDEX idx_join_requests_host
  ON agency_join_requests (host_user_id, created_at DESC) WHERE status = 'pending';

ALTER TABLE host_agent_assignments
  ADD CONSTRAINT fk_host_assignment_request
  FOREIGN KEY (join_request_id) REFERENCES agency_join_requests(id);


-- ---------------------------------------------------------------------------
-- The ledger side
--
-- Agencies get scoped accounts: coin inventory (C3/C4) and commission points.
-- Agents get commission points too — a sub-agent withdraws their own. The inventory account is non-negative like
-- every scoped account, and THAT is hard rule #3 — an agency cannot transfer a
-- coin it has not paid for, because the balance check refuses it.
-- ---------------------------------------------------------------------------
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_scope_type_check;
ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_scope_type_check
  CHECK (scope_type IN ('user', 'host', 'agent', 'agency', 'system'));

-- C4 correction, carried as a to-do since 002: a transfer moves coins and
-- NOTHING ELSE. The rupees were booked when the agency prepaid; a paise leg
-- here would recognise them twice.
UPDATE ledger_txn_types
   SET units_touched = ARRAY['coin'],
       phase = 0,
       description = 'Agency transfers coins from its prepaid inventory to a user. Coin legs only — the rupees were booked at prepay'
 WHERE code = 'purchase_reseller';

UPDATE ledger_txn_types
   SET phase = 0,
       description = 'Agency buys coin inventory, paid up front — NEVER on credit. Confirmed by a second admin'
 WHERE code = 'reseller_prepay';

-- Sub-agents are paid directly now (founder, 2026-09-28). Correct the two seed
-- descriptions that said otherwise, so nobody reads the old rule off the DB.
UPDATE ledger_txn_types
   SET description = 'Commission paid to an agency or a sub-agent, each directly — never through anyone else (hard rule #2)'
 WHERE code = 'agency_commission_payout';
UPDATE roles
   SET description = 'Brings hosts under an agency; earns commission points and withdraws them directly'
 WHERE code = 'sub_agent';

-- Commission is credited as POINTS to every party, the agency owner included;
-- rupees leave only through that party's own withdrawal (payout_* types).
UPDATE ledger_txn_types
   SET units_touched = ARRAY['point', 'paise'],
       description = 'Commission credited as points to an agency or sub-agent at period close. Never rupees directly'
 WHERE code = 'agency_commission_accrual';

-- Both reseller types stay is_active = false: the kill switch is off until the service that
-- writes them ships, and flipping it is the release step.


-- ---------------------------------------------------------------------------
-- agency_prepays · maker-checker, enforced by the database
--
-- One admin records a payment received; a DIFFERENT admin confirms it, and
-- only confirmation mints coins. The CHECK below makes "same person did both"
-- impossible rather than merely against policy.
--
-- Rate and coins are frozen at recording time, so a tier retune between
-- recording and confirmation cannot change what the agency was quoted.
-- ---------------------------------------------------------------------------
CREATE TABLE agency_prepays (
  id                 uuid PRIMARY KEY,
  agency_id          uuid NOT NULL REFERENCES agencies(id),
  amount_paise       bigint NOT NULL CHECK (amount_paise > 0),
  coins_per_rupee    integer NOT NULL CHECK (coins_per_rupee > 0),
  coins              bigint NOT NULL CHECK (coins > 0),
  method             text NOT NULL CHECK (method IN ('bank_transfer', 'upi', 'gateway')),
  -- UTR / UPI reference / gateway payment id. Unique per method, so one bank
  -- credit can never be recorded — and minted — twice.
  payment_reference  text NOT NULL CHECK (length(payment_reference) BETWEEN 4 AND 64),
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'confirmed', 'rejected')),
  recorded_by        uuid NOT NULL REFERENCES users(id),     -- maker
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  decided_by         uuid REFERENCES users(id),              -- checker
  decided_at         timestamptz,
  reject_reason      text CHECK (reject_reason IS NULL OR length(reject_reason) <= 500),
  ledger_txn_id      uuid UNIQUE REFERENCES ledger_txns(id),

  UNIQUE (method, payment_reference),

  CONSTRAINT prepay_maker_is_not_checker
    CHECK (decided_by IS NULL OR decided_by <> recorded_by),
  CONSTRAINT prepay_coins_match_rate
    CHECK (coins = amount_paise * coins_per_rupee / 100),
  CONSTRAINT prepay_state_consistent
    CHECK ((status = 'pending'   AND decided_by IS NULL     AND ledger_txn_id IS NULL)
        OR (status = 'confirmed' AND decided_by IS NOT NULL AND ledger_txn_id IS NOT NULL)
        OR (status = 'rejected'  AND decided_by IS NOT NULL AND ledger_txn_id IS NULL
                                 AND reject_reason IS NOT NULL))
);

CREATE INDEX idx_prepays_agency ON agency_prepays (agency_id, recorded_at DESC);
CREATE INDEX idx_prepays_pending ON agency_prepays (recorded_at) WHERE status = 'pending';

-- A decided prepay is final. Correcting one is a compensating ledger
-- transaction, never an edit to the record of what happened.
CREATE OR REPLACE FUNCTION agency_prepays_final() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agency_prepays rows are never deleted (prepay %)', OLD.id;
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'agency prepay % is already %; post a compensating transaction instead',
      OLD.id, OLD.status;
  END IF;
  IF NEW.agency_id <> OLD.agency_id OR NEW.amount_paise <> OLD.amount_paise
     OR NEW.coins_per_rupee <> OLD.coins_per_rupee OR NEW.coins <> OLD.coins
     OR NEW.method <> OLD.method OR NEW.payment_reference <> OLD.payment_reference
     OR NEW.recorded_by <> OLD.recorded_by OR NEW.recorded_at <> OLD.recorded_at THEN
    RAISE EXCEPTION 'agency prepay %: only the decision may be written', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_agency_prepays_final
  BEFORE UPDATE OR DELETE ON agency_prepays
  FOR EACH ROW EXECUTE FUNCTION agency_prepays_final();


-- ---------------------------------------------------------------------------
-- agency_transfers · append-only, both sides' permanent record
--
-- Written inside the ledger transaction (the gift_sends pattern): a transfer
-- that appears here can never be missing from the ledger, or the reverse.
-- One direction only — agency inventory → user. There is no column that could
-- describe any other direction, which is hard rule #7 in schema form.
-- ---------------------------------------------------------------------------
CREATE TABLE agency_transfers (
  id                 uuid PRIMARY KEY,                 -- = ledger txn id
  agency_id          uuid NOT NULL REFERENCES agencies(id),
  recipient_user_id  uuid NOT NULL REFERENCES users(id),
  coins              bigint NOT NULL CHECK (coins > 0),
  sent_by_user_id    uuid NOT NULL REFERENCES users(id),
  -- Client-generated once per transfer; part of the ledger key identity.
  request_id         uuid NOT NULL,
  ledger_txn_id      uuid NOT NULL UNIQUE REFERENCES ledger_txns(id),
  note               text CHECK (note IS NULL OR length(note) <= 140),
  created_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (agency_id, request_id),
  -- An agency owner topping up their own account is laundering-shaped and
  -- teaches nothing; refuse it at the root.
  CONSTRAINT transfer_not_to_sender CHECK (recipient_user_id <> sent_by_user_id)
);

CREATE INDEX idx_transfers_agency ON agency_transfers (agency_id, created_at DESC);
CREATE INDEX idx_transfers_recipient ON agency_transfers (recipient_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION agency_transfers_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'agency_transfers is append-only (attempted % on %). Post a compensating transaction instead.',
    TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_agency_transfers_immutable
  BEFORE UPDATE OR DELETE ON agency_transfers
  FOR EACH ROW EXECUTE FUNCTION agency_transfers_immutable();


-- ---------------------------------------------------------------------------
-- agency_listings · what a user sees in the agency list
--
-- The agency sets its OWN retail price over the wholesale rate. Payment happens
-- off-platform, so the methods listed are informational — we never touch that
-- money and never escrow it (escrow is what would make us a payment
-- aggregator).
-- ---------------------------------------------------------------------------
CREATE TABLE agency_listings (
  agency_id         uuid PRIMARY KEY REFERENCES agencies(id),
  display_name      text NOT NULL CHECK (length(display_name) BETWEEN 2 AND 40),
  -- Coins the agency gives per ₹1. Lower than wholesale is its margin.
  coins_per_rupee   integer NOT NULL CHECK (coins_per_rupee BETWEEN 1 AND 1000),
  min_order_paise   bigint NOT NULL DEFAULT 10000 CHECK (min_order_paise > 0),
  payment_methods   text[] NOT NULL
                      CHECK (cardinality(payment_methods) BETWEEN 1 AND 4
                         AND payment_methods <@ ARRAY['upi', 'paytm', 'bank_transfer', 'phonepe']),
  whatsapp_e164     text CHECK (whatsapp_e164 IS NULL OR whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  languages         text[] NOT NULL DEFAULT ARRAY['hi', 'en'],
  -- Delisting is how a suspended or misbehaving agency disappears from users
  -- without losing its history.
  is_listed         boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_listings_price ON agency_listings (coins_per_rupee DESC) WHERE is_listed;

CREATE TRIGGER agency_listings_updated_at BEFORE UPDATE ON agency_listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- The dials
--
-- Wholesale tiers set the payout ratio on agency-channel coins exactly as the
-- pack rate does on retail (`coins per ₹ ÷ 433.4`): 124 / 132 / 140 land at
-- 28.6 / 30.5 / 32.3%. Never approach ~176 — that is a 40% payout.
--
-- Caps are in coins, sized off the 110/₹ retail rate:
--   per transfer        1,100,000 ≈ ₹10,000 retail
--   per recipient/day   5,500,000 ≈ ₹50,000
--   per agency/day     22,000,000 ≈ ₹2,00,000, and 500 transfers
--
-- Commission levels D/C/B/A/S (founder, 2026-09-28): rates are decided, the
-- point bands are starting values. Withdrawals: $10 host / $20 agency and
-- sub-agent, $10 steps — stored in rupees so the floor never drifts with the
-- exchange rate.
-- ---------------------------------------------------------------------------
INSERT INTO app_config (key, value, description) VALUES
  ('agency',
   '{"minPrepayPaise": 1000000,
     "wholesaleTiers": [
       {"minPaise": 1000000,  "coinsPerRupee": 124},
       {"minPaise": 5000000,  "coinsPerRupee": 132},
       {"minPaise": 20000000, "coinsPerRupee": 140}
     ],
     "transferCaps": {
       "perTransferMaxCoins":    1100000,
       "perRecipientDailyCoins": 5500000,
       "perAgencyDailyCoins":    22000000,
       "perAgencyDailyCount":    500
     },
     "joinRequestExpiryDays": 7}'::jsonb,
   'Agency channel: ₹10,000 prepay floor, wholesale coins/₹ by prepay size (sets the payout ratio on these coins — ÷ 433.4), transfer velocity caps in coins per IST day, and how long a join request stays open.'),

  ('commission_levels',
   '[{"level": "D", "minPoints": 0,         "rateBp":  400},
     {"level": "C", "minPoints": 5000000,   "rateBp":  800},
     {"level": "B", "minPoints": 25000000,  "rateBp": 1200},
     {"level": "A", "minPoints": 100000000, "rateBp": 1600},
     {"level": "S", "minPoints": 250000000, "rateBp": 2000}]'::jsonb,
   'Commission level by team points earned in the PREVIOUS period; sets this period''s rate. A new agency starts at D and falls at most one level per period. A sub-agent''s rate is capped at their agency''s. Bands are points — rescale them if points_per_rupee is retuned.'),

  ('withdrawals',
   '{"host":   {"minPaise": 100000, "stepPaise": 100000},
     "agent":  {"minPaise": 200000, "stepPaise": 100000},
     "agency": {"minPaise": 200000, "stepPaise": 100000}}'::jsonb,
   'Point withdrawals: host from ₹1,000 (≈$10), agency and sub-agent from ₹2,000 (≈$20), whole ₹1,000 steps only. Converted to points at points_per_rupee, so no rounding residue.')
ON CONFLICT (key) DO NOTHING;
