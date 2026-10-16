-- ============================================================================
-- 031 · Host verification, and the enforcement log behind it
--
-- Two checks, decided 2026-10-16 after looking at what the category does:
--
--   ONBOARDING, once    phone OTP (built) + a face image reviewed BY A HUMAN.
--                       China's NRTA directive — the regulation most of this
--                       category is shaped by — requires exactly this pair,
--                       "facial recognition AND manual review". At 30–50 hosts
--                       a person is more accurate than any vendor and costs
--                       nothing.
--
--   EVERY GO-LIVE       a face frame is CAPTURED and queued. It does not block
--                       anything. A moderator reviews it afterwards and can
--                       flag, end the room, or suspend the host.
--
-- ── Why going live is not gated on the check ────────────────────────────────
--
-- A gate fails on real hosts: bad light, glasses, a cheap front camera, a dark
-- room — which is most hosts, most evenings. Every false reject is a host who
-- cannot earn, in a category where host supply is the thing most likely to
-- kill the product. The gate buys catching, in real time, a case a moderator
-- catches an hour later anyway.
--
-- What makes an hour good enough is the PAYOUT HOLD. Earnings sit 7–14 days
-- before they can be withdrawn (M8), so a handoff caught within a day is caught
-- long before any money leaves. Suspension stops future earning; the hold stops
-- past earning from leaving. Two levers, and neither needs to be instant.
--
-- When review stops scaling — somewhere past a few hundred hosts — the gate
-- earns its place as a free on-device filter so humans only see ambiguous
-- frames. The provider interface is built for that swap.
--
-- ── What this is defending against ──────────────────────────────────────────
--
-- One thing: ACCOUNT HANDOFF. A verified adult's account used by somebody
-- else — a minor (hard rule #5, existential), or an account rented out, which
-- is a known problem in a category that runs hosts through agency networks.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- host_verifications · the one-time check
-- ---------------------------------------------------------------------------
CREATE TABLE host_verifications (
  user_id        uuid PRIMARY KEY REFERENCES users(id),

  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),

  -- The image key in R2, never the image itself and never a copy in Postgres.
  -- `media.claimUpload` has already proved the object exists and belongs to
  -- this user before the key is written here.
  face_key       text NOT NULL,

  -- Decided by a human, and WHICH human. An approval nobody is named on is an
  -- approval nobody can be asked about.
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  -- Shown to the host on a rejection, so "try again in better light" is
  -- possible and "rejected" alone is not the whole message.
  reviewer_note  text CHECK (reviewer_note IS NULL OR length(reviewer_note) <= 500),

  submitted_at   timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- A decision must name its decider, and an undecided row must not pretend to
  -- have one.
  CONSTRAINT verification_decided_together CHECK (
    (status IN ('pending', 'expired') AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE TRIGGER host_verifications_updated_at BEFORE UPDATE ON host_verifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The review queue: oldest first, so nobody waits behind a newer submission.
CREATE INDEX host_verifications_queue_idx ON host_verifications (submitted_at)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- face_checks · one row per go-live
-- ---------------------------------------------------------------------------
CREATE TABLE face_checks (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  room_id       uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,

  face_key      text NOT NULL,

  -- Why this one was queued, so a reviewer knows what they are looking for and
  -- so the sampling rules can be retuned against what actually caught things.
  reason        text NOT NULL CHECK (reason IN (
                  'new_device',   -- first stream from this device
                  'stale',        -- no review in the last 24h
                  'flagged',      -- an open moderation flag on the account
                  'sample'        -- the random slice, so it cannot be waited out
                )),

  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'ok', 'mismatch', 'unclear')),

  reviewed_by   uuid REFERENCES users(id),
  reviewed_at   timestamptz,

  -- Which device, so "this account streams from four phones" is answerable.
  device_id     text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT face_check_decided_together CHECK (
    (status = 'pending' AND reviewed_by IS NULL)
    OR (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX face_checks_queue_idx ON face_checks (created_at) WHERE status = 'pending';
-- "Show me this host's history" — the question a reviewer asks on a mismatch.
CREATE INDEX face_checks_user_idx ON face_checks (user_id, created_at DESC);
-- The `stale` rule reads the last OK for this user.
CREATE INDEX face_checks_last_ok_idx ON face_checks (user_id, reviewed_at DESC) WHERE status = 'ok';

-- ---------------------------------------------------------------------------
-- enforcement_actions · what a moderator did, and why
-- ---------------------------------------------------------------------------
--
-- Append-only. Every action taken against a host or a room lands here, and
-- nothing is ever edited or deleted — an enforcement log that can be rewritten
-- is not evidence, and the appeal flow (M9) depends on a second reviewer being
-- able to see exactly what the first one did.
CREATE TABLE enforcement_actions (
  id           uuid PRIMARY KEY,
  actor_id     uuid NOT NULL REFERENCES users(id),

  subject_type text NOT NULL CHECK (subject_type IN ('user', 'room')),
  subject_id   uuid NOT NULL,

  -- Three severities, because the cases are genuinely different. `flag` is
  -- invisible to the subject; `end_room` closes one broadcast and is a
  -- correction; `suspend` stops them going live at all and is a punishment.
  action       text NOT NULL CHECK (action IN (
                 'flag', 'end_room', 'suspend', 'unsuspend', 'clear_flag'
               )),

  -- What prompted it. A free-text-only log cannot be counted or triaged.
  source       text NOT NULL CHECK (source IN ('face_check', 'report', 'manual')),
  source_id    uuid,

  note         text CHECK (note IS NULL OR length(note) <= 1000),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX enforcement_subject_idx ON enforcement_actions (subject_type, subject_id, created_at DESC);
CREATE INDEX enforcement_recent_idx ON enforcement_actions (created_at DESC);

CREATE OR REPLACE FUNCTION enforcement_actions_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'enforcement_actions is append-only (attempted % on %)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforcement_immutable
  BEFORE UPDATE OR DELETE ON enforcement_actions
  FOR EACH ROW EXECUTE FUNCTION enforcement_actions_immutable();

COMMENT ON TABLE enforcement_actions IS
  'Append-only. A moderation log that can be rewritten is not evidence, and the '
  'appeal flow depends on a second reviewer seeing what the first one did.';

-- ---------------------------------------------------------------------------
-- A suspended host cannot go live
-- ---------------------------------------------------------------------------
--
-- On `users` rather than derived from the log, because `goLive` has to answer
-- "is this host suspended" on every attempt and walking an append-only log for
-- that is the wrong shape. The log says WHY; this says WHETHER.
ALTER TABLE users
  ADD COLUMN host_suspended_at timestamptz,
  ADD COLUMN host_flagged_at timestamptz;

COMMENT ON COLUMN users.host_suspended_at IS
  'Set by a moderator. While non-null the user cannot go live at all. Cleared '
  'only by another moderator action, which is itself logged.';
COMMENT ON COLUMN users.host_flagged_at IS
  'Invisible to the user. Every future go-live is queued for review.';

INSERT INTO app_config (key, value, description) VALUES (
  'verification',
  '{
     "faceCheckOnGoLive": true,
     "staleAfterHours": 24,
     "samplePercent": 10,
     "requireApprovedToGoLive": false
   }'::jsonb,
  'Host verification dials. faceCheckOnGoLive=false stops capturing frames '
  '(the kill switch). staleAfterHours and samplePercent tune which go-lives are '
  'queued for review. requireApprovedToGoLive gates going live on an approved '
  'one-time verification — FALSE for the beta, because the seeded hosts are '
  'onboarded by hand and blocking them on a queue nobody is watching yet would '
  'stop the platform before it starts.'
);
