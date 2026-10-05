-- ---------------------------------------------------------------------------
-- 023 · Sub-agents, and what happens to their hosts
--
-- The tree from CLAUDE.md "Roles" has existed since 019 — agents, the dated
-- agent→agency link, and `can_manage_agents` as a per-account grant rather than
-- a second role name. What was missing is the way a second agent gets into it.
--
-- An agent seat is now a PAYEE: a sub-agent earns commission points on their
-- own hosts and withdraws them directly (founder, 2026-09-28). So joining one
-- needs the person's consent, exactly as a host joining an agency does, and for
-- the same reason — nobody is enrolled into an earning relationship by someone
-- else filling in a form.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- agent_invites
--
-- The agency side invites; the person accepts. Mirrors agency_join_requests,
-- deliberately: one pending invite per pair, an expiry, and a decision that is
-- written once.
--
-- `can_manage_agents` is carried on the invite rather than set afterwards, so
-- the person can see what they are being offered — a sub-agent who may recruit
-- other agents is a different job from one who may not.
-- ---------------------------------------------------------------------------
CREATE TABLE agent_invites (
  id                 uuid PRIMARY KEY,
  agency_id          uuid NOT NULL REFERENCES agencies(id),
  invited_user_id    uuid NOT NULL REFERENCES users(id),
  can_manage_agents  boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  message            text CHECK (message IS NULL OR length(message) <= 300),
  invited_by         uuid NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  decided_at         timestamptz,

  CONSTRAINT agent_invite_decision_complete
    CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT agent_invite_expiry_valid CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX uq_agent_invite_pending
  ON agent_invites (agency_id, invited_user_id) WHERE status = 'pending';
CREATE INDEX idx_agent_invites_user
  ON agent_invites (invited_user_id, created_at DESC) WHERE status = 'pending';
CREATE INDEX idx_agent_invites_agency
  ON agent_invites (agency_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- Why `agents.status` matters more now
--
-- Removing an agent closes their dated link and marks the seat 'removed'. Their
-- HOSTS do not leave with them — the hosts joined an agency, not a person, and
-- a host who woke up with no agency would stop earning through no act of their
-- own. They move to the agency owner's seat instead, by closing each dated link
-- and opening a new one at the same instant.
--
-- That is why both links are dated and why commission is attributed by GIFT
-- TIMESTAMP: a host moved on the 14th has the first half of the month credited
-- to the agent who left and the second half to the owner, with no row rewritten
-- and nothing to recompute.
--
-- The index makes "who does this agent still hold?" cheap, which is the
-- question asked immediately before every removal.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_host_assignments_open_agent
  ON host_agent_assignments (agent_id) WHERE effective_to IS NULL;


-- ---------------------------------------------------------------------------
-- Suspension needs a trail, not just a flag
--
-- `agencies.status` and `suspended_reason` came with 019. An agency that was
-- suspended, argued its case and was reinstated has a history that matters to
-- the next person deciding, so each change is recorded rather than overwritten.
-- ---------------------------------------------------------------------------
CREATE TABLE agency_status_changes (
  id           uuid PRIMARY KEY,
  agency_id    uuid NOT NULL REFERENCES agencies(id),
  from_status  text NOT NULL,
  to_status    text NOT NULL CHECK (to_status IN ('active', 'suspended', 'closed')),
  reason       text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  changed_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agency_status_actually_changed CHECK (from_status <> to_status)
);

CREATE INDEX idx_agency_status_changes ON agency_status_changes (agency_id, created_at DESC);
