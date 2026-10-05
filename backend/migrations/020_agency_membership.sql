-- ---------------------------------------------------------------------------
-- 020 · Agency membership: joining, quitting, the in-house agency
--
-- Decisions (founder, 2026-10-05): build-plan M12 "Membership rules",
-- ledger-decisions § M12 membership.
--
-- Quitting follows the competitor flow the founder chose, rule for rule:
--   1. An application nobody acts on for 7 days lets the host go automatically.
--   2. A host who has never attempted face authentication may quit at once.
--   3. A host who joined less than a day ago may quit at once.
--   4. One application per 30 days, whatever happened to the last one.
--   5. The agency OWNER may still approve within 14 days of rejecting.
-- Only the agency owner decides — never a sub-agent, never the platform.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- The in-house agency
--
-- The first 30-50 hosts are recruited by us, months before any agency exists,
-- and a host must be in an agency to earn. They sit in one agency we own. It
-- earns no commission (enforced by the commission engine reading this flag),
-- and its hosts move to a real agency through the ordinary quit and join flow.
-- ---------------------------------------------------------------------------
ALTER TABLE agencies ADD COLUMN is_house boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX uq_agency_house ON agencies (is_house) WHERE is_house;


-- ---------------------------------------------------------------------------
-- Face authentication marker
--
-- Rule 2 above turns on whether the host has ever ATTEMPTED face match. The
-- face match itself is M8 (PAN + face before any payout, hard rule #5); until
-- it ships nobody has attempted it, so every quit is immediate — which is the
-- honest reading of the rule, not a gap in it.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN face_auth_attempted_at timestamptz;


-- ---------------------------------------------------------------------------
-- agency_quit_requests
--
-- One row per application. A direct quit (rules 2 and 3) still writes a row,
-- with status 'direct', because rule 4 counts applications, not outcomes.
--
--   pending      waiting on the agency owner
--   approved     the owner agreed (possibly within 14 days of rejecting)
--   rejected     the owner refused; the host stays
--   auto_left    7 days passed with no decision
--   direct       allowed at once by rule 2 or 3
--   void         the host left by another route while it was pending
-- ---------------------------------------------------------------------------
CREATE TABLE agency_quit_requests (
  id                  uuid PRIMARY KEY,
  host_user_id        uuid NOT NULL REFERENCES users(id),
  host_assignment_id  uuid NOT NULL REFERENCES host_agent_assignments(id),
  agency_id           uuid NOT NULL REFERENCES agencies(id),
  reason              text NOT NULL CHECK (length(reason) BETWEEN 1 AND 100),
  status              text NOT NULL
                        CHECK (status IN ('pending', 'approved', 'rejected', 'auto_left', 'direct', 'void')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  rejected_at         timestamptz,
  rejected_by         uuid REFERENCES users(id),
  resolved_at         timestamptz,
  resolved_by         uuid REFERENCES users(id),

  CONSTRAINT quit_rejection_complete
    CHECK ((rejected_at IS NULL) = (rejected_by IS NULL)),
  CONSTRAINT quit_resolution_matches_status
    CHECK ((status IN ('pending', 'rejected')) = (resolved_at IS NULL)),
  -- Only a rejected application can later be approved, and only by the owner
  -- who could have approved it in the first place.
  CONSTRAINT quit_rejected_has_rejection
    CHECK (status <> 'rejected' OR rejected_at IS NOT NULL)
);

-- At most one open application per host.
CREATE UNIQUE INDEX uq_quit_pending ON agency_quit_requests (host_user_id) WHERE status = 'pending';
-- Rule 4's lookup: the host's most recent application.
CREATE INDEX idx_quit_host_recent ON agency_quit_requests (host_user_id, created_at DESC);
-- The owner's inbox, and the auto-leave sweep.
CREATE INDEX idx_quit_agency_open ON agency_quit_requests (agency_id, created_at)
  WHERE status IN ('pending', 'rejected');


-- ---------------------------------------------------------------------------
-- Dials
-- ---------------------------------------------------------------------------

-- Level bands retuned so a small agency can climb (founder accepted the
-- recommendation, 2026-10-05): C should be within reach of 5-10 active hosts
-- in an agency's first months, or agencies sit at D and leave. At 260 points/₹:
--   C   2M points ≈ ₹7.7K of team earnings in the period
--   B  10M        ≈ ₹38K
--   A  50M        ≈ ₹1.9L
--   S 150M        ≈ ₹5.8L
UPDATE app_config SET value =
  '[{"level": "D", "minPoints": 0,         "rateBp":  400},
    {"level": "C", "minPoints": 2000000,   "rateBp":  800},
    {"level": "B", "minPoints": 10000000,  "rateBp": 1200},
    {"level": "A", "minPoints": 50000000,  "rateBp": 1600},
    {"level": "S", "minPoints": 150000000, "rateBp": 2000}]'::jsonb
 WHERE key = 'commission_levels';

-- Membership timings, and lower transfer caps for an agency's first 30 days —
-- fraud and laundering cluster in a new agency's first weeks.
UPDATE app_config SET value = value || '{
    "quit": {"autoLeaveDays": 7, "directIfJoinedWithinHours": 24,
             "cooldownDays": 30, "approveAfterRejectDays": 14},
    "newAgency": {"days": 30, "transferCaps": {
       "perTransferMaxCoins":    275000,
       "perRecipientDailyCoins": 1100000,
       "perAgencyDailyCoins":    5500000,
       "perAgencyDailyCount":    100}}
  }'::jsonb
 WHERE key = 'agency';

INSERT INTO app_config (key, value, description) VALUES
  ('point_to_coin_bonus_bp', '0',
   'Points→coins exchange bonus in basis points. 0 = value parity (2 points → 1 coin). Even +2000 costs far less than paying the same points out in cash (ledger-decisions § C28).')
ON CONFLICT (key) DO NOTHING;
