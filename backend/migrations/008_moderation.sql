-- ===========================================================================
-- 008_moderation — reports and blocks
--
-- Not a nice-to-have and not deferrable. Both Google Play and the App Store
-- require a working report mechanism for any app carrying user-generated
-- content, and a live-streaming app is the strongest possible case of it. An
-- app without this is rejected at review, before a single user sees it.
--
-- This is the INTAKE half only. Queue triage, strikes, appeals and the
-- automated classifiers are M9 and need the policy in trust-and-safety-v1
-- turned into rules first. What matters now is that a report is never lost:
-- a row here is a durable record even with nobody yet reading the queue.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- reports
--
-- One row per report, never deduplicated. Twenty people reporting the same
-- host is the single strongest signal moderation has, and collapsing them into
-- one row destroys exactly the thing that makes it actionable.
-- ---------------------------------------------------------------------------
CREATE TABLE reports (
  id                uuid PRIMARY KEY,
  reporter_user_id  uuid NOT NULL REFERENCES users(id),

  -- What is being reported. A room and a user are different remedies: ending a
  -- stream is immediate and reversible, banning an account is neither.
  subject_type      text NOT NULL CHECK (subject_type IN ('user','room','message')),
  subject_id        uuid NOT NULL,

  -- A CLOSED set, mapped to the policy levels in trust-and-safety-v1. Free text
  -- alone cannot be triaged, counted, or turned into an automatic threshold —
  -- and "nudity" arriving 50 times in an hour has to be able to page someone.
  reason            text NOT NULL CHECK (reason IN (
                      'nudity','harassment','hate','violence','self_harm',
                      'minor','scam','spam','impersonation','illegal','other')),

  -- Optional, and bounded. Useful context; never the primary signal.
  detail            text CHECK (detail IS NULL OR length(detail) <= 500),

  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','reviewing','actioned','dismissed')),
  reviewed_by       uuid REFERENCES users(id),
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- The day this was filed, as a plain date, purely so the per-reporter
  -- uniqueness below can be an index. `created_at::date` cannot: converting a
  -- timestamptz to a date depends on the session timezone, so Postgres marks it
  -- STABLE rather than IMMUTABLE and refuses it in an index expression. A
  -- DEFAULT has no such restriction.
  reported_on       date NOT NULL DEFAULT CURRENT_DATE,

  CONSTRAINT reports_not_self CHECK (
    subject_type <> 'user' OR subject_id <> reporter_user_id
  )
);

-- The moderation queue: oldest open first, so nothing starves.
CREATE INDEX reports_queue_idx ON reports (created_at)
  WHERE status = 'open';

-- "How many reports against this subject, recently" — the threshold query that
-- auto-escalation will run, and the first thing a reviewer asks.
CREATE INDEX reports_subject_idx ON reports (subject_type, subject_id, created_at DESC);

-- One report per person per subject per day. Without it, a coordinated group
-- inflates the count by spamming rather than by being many people — which is
-- precisely the signal the count is meant to carry.
CREATE UNIQUE INDEX reports_one_per_day_idx
  ON reports (reporter_user_id, subject_type, subject_id, reported_on);


-- ---------------------------------------------------------------------------
-- blocks
--
-- Personal and one-directional: `blocker` no longer wants to see `blocked`.
-- Distinct from a ban, which is the platform's decision and applies to everyone.
--
-- A block is the remedy a user can apply IMMEDIATELY, without waiting for a
-- moderator. That matters more than it sounds: the gap between "I reported
-- this" and "someone looked at it" is hours at best, and a user with no way to
-- act in the meantime leaves.
-- ---------------------------------------------------------------------------
CREATE TABLE blocks (
  blocker_user_id uuid NOT NULL REFERENCES users(id),
  blocked_user_id uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CONSTRAINT blocks_not_self CHECK (blocker_user_id <> blocked_user_id)
);

-- "Whose rooms should I not see" — joined on every feed request, so it has to
-- be an index seek rather than a scan.
CREATE INDEX blocks_blocker_idx ON blocks (blocker_user_id);
-- The mirror: hiding the blocker from the blocked user's room and lists too.
CREATE INDEX blocks_blocked_idx ON blocks (blocked_user_id);
