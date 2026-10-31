-- ---------------------------------------------------------------------------
-- 038 · The event log: important events and every error, kept in Postgres
--
-- Structured stdout logging (infra/logger.ts) has existed since M1 and is what
-- CloudWatch or ClickHouse will ingest — one day. Until that pipeline exists,
-- a log line is gone the moment the container is replaced, and even with it a
-- founder answering "what happened to this user last night" should not need a
-- query language for a log store.
--
-- So the things worth keeping are ALSO written here: every 5xx and every
-- unexpected error from all three processes, security signals (a replayed
-- refresh token, a rate limit tripped), the audit trail of who did what (a
-- sign-in, a password change, a kill switch, an enforcement action, a prepay
-- confirmed, a purchase credited), scheduled jobs failing, alerts raised, and
-- errors the APP reports about itself. Browsed at /admin/events.
--
-- What this is NOT: an analytics store. gift_sends, purchases, rooms and the
-- outbox already hold the product's history, and a feed event per impression
-- would drown the one row that matters. Store the few things an operator
-- needs to see, and keep them for weeks, not forever.
-- ---------------------------------------------------------------------------

CREATE TABLE system_events (
  id           uuid PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  -- Which of the three processes wrote it — or the app, via /v1/client/events.
  process      text NOT NULL CHECK (process IN ('api', 'gateway', 'workers', 'app')),
  level        text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  -- A coarse category for the filter rail: error · security · auth · account ·
  -- money · moderation · config · room · job · alert · app.
  kind         text NOT NULL CHECK (length(kind) BETWEEN 1 AND 32),
  -- The specific thing, `noun.verb`: auth.signed_in, job.failed, config.feature_switched.
  event        text NOT NULL CHECK (length(event) BETWEEN 1 AND 64),
  -- The stable error code when there is one (INTERNAL_ERROR, RATE_LIMITED …).
  code         text CHECK (length(code) <= 64),
  message      text CHECK (length(message) <= 500),
  -- Groups repeats of the same problem: a hash of process + event + code + the
  -- first stack frame (or the message). The admin screen counts by this, so
  -- two hundred copies of one bug read as one row with a count.
  fingerprint  text NOT NULL CHECK (length(fingerprint) = 16),
  trace_id     text CHECK (length(trace_id) <= 64),
  -- Deliberately NOT a foreign key. The log must never fail to write because a
  -- user was deleted, and a deleted account still has a history worth reading.
  user_id      uuid,
  path         text CHECK (length(path) <= 200),
  -- Sanitised before it gets here (infra/eventLog.ts): secrets redacted by key
  -- name, strings capped, depth capped, the whole object capped at 8 KB.
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX system_events_time_idx        ON system_events (occurred_at DESC);
CREATE INDEX system_events_level_time_idx  ON system_events (level, occurred_at DESC);
CREATE INDEX system_events_kind_time_idx   ON system_events (kind, occurred_at DESC);
CREATE INDEX system_events_fingerprint_idx ON system_events (fingerprint, occurred_at DESC);
CREATE INDEX system_events_user_idx        ON system_events (user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX system_events_trace_idx       ON system_events (trace_id)
  WHERE trace_id IS NOT NULL;

-- A log that can be edited is not a log. UPDATE is refused outright; DELETE
-- is left open ONLY for the retention job, which deletes by age and nothing
-- else (ops/roles.sql revokes UPDATE for the app role as well).
CREATE OR REPLACE FUNCTION system_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'system_events is append-only (attempted % on %)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_system_events_immutable
  BEFORE UPDATE ON system_events
  FOR EACH ROW EXECUTE FUNCTION system_events_immutable();

COMMENT ON TABLE system_events IS
  'Important events and every error, from all three processes and the app. '
  'Append-only; rows leave only by the retention job. Browse at /admin/events.';

-- How long each level is kept, and what counts as a burst worth an alert.
-- Errors are kept longest because they are what a post-mortem reads; info
-- rows are the audit trail and are plentiful.
INSERT INTO app_config (key, value, description) VALUES
  ('event_log',
   '{"retentionDays": {"info": 30, "warn": 60, "error": 90},
     "burst": {"windowMinutes": 5, "sameErrorToAlert": 20, "totalErrorsToAlert": 60}}'::jsonb,
   'The event log: retention per level in days, and the thresholds the burst check alerts at — the same error N times in the window, or N errors of any kind.')
ON CONFLICT (key) DO NOTHING;
