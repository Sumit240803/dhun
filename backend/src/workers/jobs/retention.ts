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
 * Clears old room chat.
 *
 * This table grows faster than every other one here combined — a busy room is
 * hundreds of rows an hour, and none of it is interesting after a fortnight.
 * It was promised a purge in the migration that created it and did not have
 * one, which is the kind of gap that is invisible until the disk fills.
 *
 * Fourteen days, chosen against what actually reads this table:
 *
 *   · The join backlog reads the last 40 messages — minutes, not days.
 *   · A moderation case (M9) is opened from a report, and a report filed a
 *     fortnight after the message is not one anyone can act on.
 *   · IT Rules 2021 require a grievance process able to examine what happened.
 *     Two weeks covers the 15-day acknowledgement window comfortably.
 *
 * Deleted in BATCHES rather than one statement. A single DELETE over a month of
 * a busy room takes a long lock on the table the gateway writes to on every
 * chat line, and the whole point of running at 05:15 IST is to be invisible.
 */
export const purgeRoomMessagesJob: Job = {
  name: 'purge_room_messages',
  dailyAtIst: '05:15',
  run: async () => {
    const BATCH = 5_000;
    let deleted = 0;

    for (;;) {
      const { rowCount } = await pool.query(
        `DELETE FROM room_messages
          WHERE id IN (
            SELECT id FROM room_messages
             WHERE created_at < now() - interval '14 days'
             LIMIT $1
          )`,
        [BATCH],
      );

      deleted += rowCount ?? 0;
      // A short batch means the last one. Stopping here rather than looping
      // until zero saves a final empty scan of a large table.
      if ((rowCount ?? 0) < BATCH) break;
    }

    return deleted ? { deleted } : undefined;
  },
};

/**
 * Clears resolved mic requests.
 *
 * Only the terminal ones. A row still `pending` belongs to a live room and a
 * person watching for an answer — deleting it would drop them out of the
 * queue with no explanation.
 *
 * Seven days rather than fourteen: the signal these carry is "a host keeps
 * refusing this person", which is a pattern read within days or not at all.
 */
export const purgeMicRequestsJob: Job = {
  name: 'purge_mic_requests',
  dailyAtIst: '05:30',
  run: async () => {
    const { rowCount } = await pool.query(
      `DELETE FROM room_mic_requests
        WHERE status <> 'pending' AND resolved_at < now() - interval '7 days'`,
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
