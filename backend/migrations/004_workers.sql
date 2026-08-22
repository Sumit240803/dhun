-- ============================================================================
-- 004 · Worker infrastructure: job history, reconciliation results, outbox wakeup
--
-- The workers process owns the scheduled side of the system: shipping the
-- outbox, the nightly reconciliation (day-1 non-negotiable #1), and retention
-- purges. Payout batches, TDS accrual and commission recalc join it in M8.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- job_runs · every scheduled execution, successful or not
--
-- Without this a silent job failure is invisible: nothing errors, nothing
-- alerts, and the outbox simply stops draining. "When did this last succeed?"
-- has to be answerable.
-- ---------------------------------------------------------------------------
CREATE TABLE job_runs (
  id           bigserial PRIMARY KEY,
  job          text NOT NULL,
  status       text NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running','success','failed','skipped')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  duration_ms  integer,
  result       jsonb,
  error        text
);

CREATE INDEX idx_job_runs_recent ON job_runs (job, started_at DESC);
-- Finds a run that started and never finished — i.e. the process died mid-job.
CREATE INDEX idx_job_runs_stuck ON job_runs (started_at) WHERE status = 'running';


-- ---------------------------------------------------------------------------
-- reconciliation_checks · one row per check, per run
--
-- A dedicated table rather than a blob inside job_runs, because the closed-beta
-- exit criterion is "ledger zero mismatches, 7 consecutive days" — and that
-- should be one query, not an archaeology exercise.
-- ---------------------------------------------------------------------------
CREATE TABLE reconciliation_checks (
  id          bigserial PRIMARY KEY,
  run_id      bigint NOT NULL REFERENCES job_runs(id),
  run_date    date NOT NULL DEFAULT current_date,
  check_name  text NOT NULL,
  status      text NOT NULL CHECK (status IN ('pass','fail','skipped')),
  -- Never a sample of offending rows: a mismatch is a bug, and the detail
  -- belongs in the alert, not in a table anyone might paste into a ticket.
  mismatch_count integer NOT NULL DEFAULT 0,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recon_by_date ON reconciliation_checks (run_date DESC, check_name);
CREATE INDEX idx_recon_failures ON reconciliation_checks (run_date DESC) WHERE status = 'fail';

COMMENT ON TABLE reconciliation_checks IS
  'Beta exit criterion: SELECT count(DISTINCT run_date) FROM reconciliation_checks '
  'WHERE run_date > current_date - 7 AND status = ''fail'' must be 0.';


-- ---------------------------------------------------------------------------
-- Outbox wakeup
--
-- The shipper polls on a floor interval so nothing is ever stranded, but polling
-- alone adds latency to every event. This NOTIFY lets it wake the instant a row
-- lands, without the application having to remember to signal.
--
-- pg_notify fires on COMMIT, so a rolled-back transaction never wakes anyone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_outbox() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('outbox_new', '');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Statement-level: one notification per INSERT statement, not one per row. A
-- gift writing several events should wake the shipper once.
CREATE TRIGGER trg_outbox_notify
  AFTER INSERT ON outbox
  FOR EACH STATEMENT EXECUTE FUNCTION notify_outbox();
