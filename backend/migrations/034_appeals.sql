-- ---------------------------------------------------------------------------
-- 034 · Appeals
--
-- A suspended host can say "this was a mistake" and have a DIFFERENT person
-- look at it. M9's one exit criterion that needs no vendor: "appeal reaches a
-- second reviewer". IT Rules 2021 want a grievance process able to examine
-- what happened; the append-only enforcement log is what makes that possible,
-- and this is the door to it.
--
-- One appeal per suspension. The suspension is an enforcement_actions row, so
-- a host suspended twice can appeal twice, and nobody can appeal the same
-- decision a dozen times hoping for a softer reviewer.
-- ---------------------------------------------------------------------------

CREATE TABLE appeals (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id),
  -- The suspension being appealed. UNIQUE: one appeal per decision.
  action_id      uuid NOT NULL UNIQUE REFERENCES enforcement_actions(id),
  message        text NOT NULL CHECK (length(message) BETWEEN 20 AND 1000),

  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'upheld', 'overturned')),
  -- Never the person who suspended them. Checked in the service, and the log
  -- keeps both ids so the rule can be audited after the fact.
  reviewer_id    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  -- Written to be SHOWN to the host, like a verification rejection note.
  reviewer_note  text CHECK (reviewer_note IS NULL OR length(reviewer_note) <= 500),

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX appeals_open_idx ON appeals (created_at) WHERE status = 'open';
CREATE INDEX appeals_user_idx ON appeals (user_id, created_at DESC);

-- Lifting a suspension because an appeal succeeded is its own kind of action
-- in the log, so "how many suspensions did we get wrong" is a count.
ALTER TABLE enforcement_actions DROP CONSTRAINT enforcement_actions_source_check;
ALTER TABLE enforcement_actions ADD CONSTRAINT enforcement_actions_source_check
  CHECK (source IN ('face_check', 'report', 'manual', 'appeal'));
