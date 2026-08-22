// Retention jobs.
//
// Each one deletes something we PROMISED to delete, or keeps a table from
// growing without bound. Nothing here touches the ledger: entries are
// append-only and permanent, and the append-only grant in ops/roles.sql means a
// job could not delete one even if it tried.

import { pool } from '../../infra/db.js';
import type { Job } from '../scheduler.js';

/**
 * Drops cached idempotency responses past their advertised life.
 *
 * The KEY is kept forever — it is part of the audit trail, and it is what stops
 * a stray retry from double-applying years later. Only the cached response body
 * goes, after which a late replay still gets a truthful answer, just without the
 * original payload.
 */
export const purgeIdempotencyBodiesJob: Job = {
  name: 'purge_idempotency_bodies',
  dailyAtIst: '04:00',
  run: async () => {
    const { rowCount } = await pool.query(
      'UPDATE ledger_txns SET response_body = NULL' +
        " WHERE response_body IS NOT NULL AND created_at < now() - interval '7 days'",
    );
    return rowCount ? { purged: rowCount } : undefined;
  },
};

/**
 * Clears shipped outbox rows once they are safely past replay range.
 *
 * Unpublished rows are never touched, however old — one sitting there is a
 * problem to investigate, not rubbish to sweep up.
 */
export const purgeShippedOutboxJob: Job = {
  name: 'purge_shipped_outbox',
  dailyAtIst: '04:15',
  run: async () => {
    const { rowCount } = await pool.query(
      "DELETE FROM outbox WHERE published_at IS NOT NULL AND published_at < now() - interval '30 days'",
    );
    return rowCount ? { deleted: rowCount } : undefined;
  },
};

/**
 * Clears expired and consumed OTP challenges.
 *
 * Codes are hashed, but an unbounded table of authentication attempts is a
 * liability with no upside. A week is kept so a support question about "I never
 * got the code" can still be answered.
 */
export const purgeOtpChallengesJob: Job = {
  name: 'purge_otp_challenges',
  dailyAtIst: '04:30',
  run: async () => {
    const { rowCount } = await pool.query(
      "DELETE FROM otp_challenges WHERE created_at < now() - interval '7 days'",
    );
    return rowCount ? { deleted: rowCount } : undefined;
  },
};

/**
 * Clears refresh tokens that expired or were revoked a while ago.
 *
 * Recent revocations are retained on purpose: a revoked chain is the evidence
 * that a replay was detected, and that is worth having during an investigation.
 */
export const purgeRefreshTokensJob: Job = {
  name: 'purge_refresh_tokens',
  dailyAtIst: '04:45',
  run: async () => {
    const { rowCount } = await pool.query(
      'DELETE FROM refresh_tokens' +
        " WHERE (expires_at < now() - interval '30 days')" +
        "    OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')",
    );
    return rowCount ? { deleted: rowCount } : undefined;
  },
};

/**
 * Flags jobs that started and never finished.
 *
 * A row left at 'running' means the worker died mid-job. Harmless on its own —
 * the advisory lock is released with the connection — but it is the only trace,
 * so it gets marked rather than left to look like a job still in progress.
 */
export const reapStuckJobRunsJob: Job = {
  name: 'reap_stuck_job_runs',
  dailyAtIst: '05:00',
  run: async () => {
    const { rowCount } = await pool.query(
      "UPDATE job_runs SET status = 'failed', finished_at = now()," +
        " error = 'worker exited before the job finished'" +
        " WHERE status = 'running' AND started_at < now() - interval '1 hour'",
    );
    return rowCount ? { reaped: rowCount } : undefined;
  },
};
