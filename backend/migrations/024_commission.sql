-- ---------------------------------------------------------------------------
-- 024 · Commission: attribution, levels, and the period close
--
-- Design: backend/docs/ledger-decisions.md § "The payout flow" and the
-- commission LEVEL table. Rates are the founder's D/C/B/A/S at 4/8/12/16/20%,
-- seeded in `app_config.commission_levels` by 019 and retuned by 020.
--
-- The shape of the thing:
--
--   Per gift, nothing happens. Commission is NOT computed at gift time —
--   "recalculated monthly, never retroactive" is meant literally, and a rate
--   applied per gift would have to be trued up the moment a level moved.
--
--   At period close, one job walks every gift in the period, resolves who held
--   each host AT THAT MOMENT through the two dated links, aggregates, and posts
--   ONE transaction per payee. Nothing is ever repriced, because the rate for
--   the period was fixed before the period began — by the PREVIOUS period's
--   volume.
--
-- ONE DEVIATION from the doc, deliberate. The doc has an attribution row
-- written per gift. This writes them at close instead, derived from
-- `gift_sends` joined to the dated links by gift timestamp. Same record, same
-- audit trail, three advantages: the gift hot path is untouched (gifting is the
-- one endpoint that must never slow down), an attribution can never be missing
-- because it is derived rather than remembered, and a gift reversed while the
-- period is still open simply never becomes one — which is exactly what the doc
-- asks for in its reversal rules.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- commission_periods · one row per calendar month, in IST
--
-- The period is the unit everything else hangs off: a level belongs to a
-- period, an accrual belongs to a period, and closing is idempotent because the
-- row records that it happened.
-- ---------------------------------------------------------------------------
CREATE TABLE commission_periods (
  -- 'YYYY-MM' in IST. India's month does not end at 18:30 the day before.
  period        text PRIMARY KEY CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at     timestamptz,
  closed_by     uuid REFERENCES users(id),
  -- What the close actually did, for the morning after.
  gift_points   bigint NOT NULL DEFAULT 0,
  payee_count   integer NOT NULL DEFAULT 0,

  CONSTRAINT period_closed_consistently
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);


-- ---------------------------------------------------------------------------
-- commission_levels · the rate each payee earns in a period, fixed in advance
--
-- Written when a period OPENS, from the previous period's volume. That is the
-- whole point: an agency knows its rate before the month starts, can tell a
-- sub-agent what they will earn, and nothing is ever repriced behind them.
--
-- `measured_points` is the previous period's figure the level was read from —
-- kept so "why am I level B?" has an answer that does not require re-running
-- anything.
-- ---------------------------------------------------------------------------
CREATE TABLE commission_levels (
  period           text NOT NULL REFERENCES commission_periods(period),
  payee_type       text NOT NULL CHECK (payee_type IN ('agency', 'agent')),
  payee_id         uuid NOT NULL,
  level            text NOT NULL,
  rate_bp          integer NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  measured_points  bigint NOT NULL DEFAULT 0,
  -- True when the level was held up by the one-step-per-period floor: a ladder
  -- that erases a year of progress in one bad month loses the agency.
  cushioned        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (period, payee_type, payee_id)
);

CREATE INDEX idx_commission_levels_payee ON commission_levels (payee_type, payee_id, period DESC);


-- ---------------------------------------------------------------------------
-- commission_attributions · which gift paid whom, and at what moment
--
-- Derived at close from the gifts and the dated links, then kept. This is the
-- row that answers a dispute: a host who moved agents mid-month has their gifts
-- split across two rows by TIMESTAMP, and neither row is ever rewritten.
--
-- No rate and no money here, deliberately — those live on the accrual. This
-- table says only who earned what, and under whom.
-- ---------------------------------------------------------------------------
CREATE TABLE commission_attributions (
  gift_txn_id   uuid PRIMARY KEY REFERENCES ledger_txns(id),
  period        text NOT NULL REFERENCES commission_periods(period),
  host_user_id  uuid NOT NULL REFERENCES users(id),
  agent_id      uuid NOT NULL REFERENCES agents(id),
  agency_id     uuid NOT NULL REFERENCES agencies(id),
  -- The host's earning from that gift, in points. The base commission is taken
  -- on this, never on the coin count.
  points        bigint NOT NULL CHECK (points >= 0),
  gift_at       timestamptz NOT NULL
);

CREATE INDEX idx_attributions_period_agency ON commission_attributions (period, agency_id);
CREATE INDEX idx_attributions_period_agent ON commission_attributions (period, agent_id);
CREATE INDEX idx_attributions_host ON commission_attributions (host_user_id, gift_at DESC);


-- ---------------------------------------------------------------------------
-- commission_accruals · one row, and one ledger transaction, per payee per period
--
-- The split, in one place:
--   · a sub-agent earns their OWN hosts' points at their own rate;
--   · the agency earns the DIFFERENTIAL on those hosts, plus the full rate on
--     hosts held directly by the owner's seat.
--
-- So the total cost is always `team points × the agency's rate`, whatever the
-- shape of the tree underneath. The split decides who receives it, never how
-- much the platform pays.
-- ---------------------------------------------------------------------------
CREATE TABLE commission_accruals (
  id             uuid PRIMARY KEY,
  period         text NOT NULL REFERENCES commission_periods(period),
  payee_type     text NOT NULL CHECK (payee_type IN ('agency', 'agent')),
  payee_id       uuid NOT NULL,
  -- The team points this was computed from, and the rate applied to them.
  base_points    bigint NOT NULL CHECK (base_points >= 0),
  rate_bp        integer NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000),
  -- What was actually credited. Not always base × rate: an agency earning the
  -- differential over a sub-agent is credited the gap, not the whole.
  points         bigint NOT NULL CHECK (points > 0),
  ledger_txn_id  uuid NOT NULL UNIQUE REFERENCES ledger_txns(id),
  created_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (period, payee_type, payee_id)
);

CREATE INDEX idx_accruals_payee ON commission_accruals (payee_type, payee_id, period DESC);

-- An accrual is append-only, like every other record written beside money.
-- Correcting one is a compensating transaction in the CURRENT period, never an
-- edit to a closed one.
CREATE OR REPLACE FUNCTION commission_accruals_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'commission_accruals is append-only (attempted % on %). Post a compensating accrual in the current period instead.',
    TG_OP, COALESCE(OLD.id, NEW.id);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_commission_accruals_immutable
  BEFORE UPDATE OR DELETE ON commission_accruals
  FOR EACH ROW EXECUTE FUNCTION commission_accruals_immutable();
