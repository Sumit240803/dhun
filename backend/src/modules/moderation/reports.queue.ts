// The reports queue — what a moderator sees, and how a report is closed.
//
// A report is about a USER even when it names a room or a message: the room
// has a host and the message has a sender, and it is the person a moderator
// acts on. So every row here resolves to one, with the room or the message
// kept beside it as context. The subject can have gone — a deleted message, a
// room long ended — and the row still shows, so it can still be dismissed.
//
// Closing a report never happens on its own: the route takes the enforcement
// action FIRST (so a failure leaves the report open and visible) and resolves
// the report after. An action on a person resolves every open report about
// them; a dismissal closes only the one in hand.

import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import type { ReportReason, SubjectType } from './moderation.service.js';

export interface OpenReport {
  id: string;
  reason: ReportReason;
  detail: string | null;
  at: string;
  subjectType: SubjectType;
  reporter: { id: string; name: string | null; publicId: string };
  /** Null when the room or message, and with it the person, no longer exists. */
  subject: {
    userId: string;
    name: string | null;
    publicId: string;
    flagged: boolean;
    suspended: boolean;
    /** Open reports naming this person, their rooms or their messages. */
    openReports: number;
  } | null;
  room: { id: string; title: string; publicId: string; live: boolean } | null;
  message: { body: string } | null;
}

interface Row {
  id: string;
  reason: ReportReason;
  detail: string | null;
  created_at: Date;
  subject_type: SubjectType;
  reporter_id: string;
  reporter_name: string | null;
  reporter_public_id: string;
  subject_user_id: string | null;
  subject_name: string | null;
  subject_public_id: string | null;
  flagged: boolean | null;
  suspended: boolean | null;
  open_on_subject: string | null;
  room_id: string | null;
  room_title: string | null;
  room_public_id: string | null;
  room_live: boolean | null;
  message_body: string | null;
}

const SELECT = `
  SELECT r.id, r.reason, r.detail, r.created_at, r.subject_type,
         rp.id AS reporter_id, rpp.display_name AS reporter_name, rp.public_id AS reporter_public_id,
         s.id AS subject_user_id, sp.display_name AS subject_name, s.public_id AS subject_public_id,
         (s.host_flagged_at IS NOT NULL) AS flagged,
         (s.host_suspended_at IS NOT NULL) AS suspended,
         (SELECT count(*) FROM reports o
           WHERE o.status = 'open'
             AND ((o.subject_type = 'user' AND o.subject_id = s.id)
               OR (o.subject_type = 'room' AND o.subject_id IN
                     (SELECT id FROM rooms WHERE host_user_id = s.id))
               OR (o.subject_type = 'message' AND o.subject_id IN
                     (SELECT id FROM messages WHERE sender_user_id = s.id)))) AS open_on_subject,
         rm.id AS room_id, rm.title AS room_title, rm.public_id AS room_public_id,
         (rm.ended_at IS NULL) AS room_live,
         m.body AS message_body
    FROM reports r
    JOIN users rp ON rp.id = r.reporter_user_id
    LEFT JOIN user_profiles rpp ON rpp.user_id = rp.id
    LEFT JOIN rooms rm ON r.subject_type = 'room' AND rm.id = r.subject_id
    LEFT JOIN messages m ON r.subject_type = 'message' AND m.id = r.subject_id
    LEFT JOIN users s ON s.id = CASE r.subject_type
                                  WHEN 'user' THEN r.subject_id
                                  WHEN 'room' THEN rm.host_user_id
                                  ELSE m.sender_user_id
                                END
    LEFT JOIN user_profiles sp ON sp.user_id = s.id`;

function toReport(row: Row): OpenReport {
  return {
    id: row.id,
    reason: row.reason,
    detail: row.detail,
    at: row.created_at.toISOString(),
    subjectType: row.subject_type,
    reporter: { id: row.reporter_id, name: row.reporter_name, publicId: String(row.reporter_public_id) },
    subject:
      row.subject_user_id === null
        ? null
        : {
            userId: row.subject_user_id,
            name: row.subject_name,
            publicId: String(row.subject_public_id),
            flagged: row.flagged === true,
            suspended: row.suspended === true,
            openReports: Number(row.open_on_subject ?? 0),
          },
    room:
      row.room_id === null
        ? null
        : {
            id: row.room_id,
            title: row.room_title ?? '',
            publicId: String(row.room_public_id),
            live: row.room_live === true,
          },
    message: row.message_body === null ? null : { body: row.message_body },
  };
}

/** Newest first. A report about a live room is the one that cannot wait. */
export async function openReports(limit = 100): Promise<OpenReport[]> {
  const { rows } = await pool.query<Row>(
    `${SELECT}
      WHERE r.status = 'open'
      ORDER BY (rm.ended_at IS NULL AND r.subject_type = 'room') DESC, r.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(toReport);
}

export async function openReport(reportId: string): Promise<OpenReport> {
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) {
    throw new AppError('REPORT_NOT_FOUND', 'That report is not open', 404);
  }
  const { rows } = await pool.query<Row>(`${SELECT} WHERE r.id = $1 AND r.status = 'open'`, [
    reportId,
  ]);
  if (!rows[0]) throw new AppError('REPORT_NOT_FOUND', 'That report is not open', 404);
  return toReport(rows[0]);
}

/**
 * Closes a report, and — when the decision was about the PERSON — every other
 * open report naming them, their rooms or their messages. Twenty reports about
 * one host are one decision, not twenty.
 */
export async function resolveReport(input: {
  reportId: string;
  reviewerId: string;
  outcome: 'actioned' | 'dismissed';
  /** The subject's user id, when the outcome should close everything about them. */
  cascadeToUserId?: string;
}): Promise<{ closed: number }> {
  return withTransaction(async (client) => {
    const own = await client.query(
      `UPDATE reports SET status = $2, reviewed_by = $3, reviewed_at = now()
        WHERE id = $1 AND status = 'open'`,
      [input.reportId, input.outcome, input.reviewerId],
    );
    let closed = own.rowCount ?? 0;

    if (input.cascadeToUserId) {
      const rest = await client.query(
        `UPDATE reports SET status = $2, reviewed_by = $3, reviewed_at = now()
          WHERE status = 'open'
            AND ((subject_type = 'user' AND subject_id = $1)
              OR (subject_type = 'room' AND subject_id IN
                    (SELECT id FROM rooms WHERE host_user_id = $1))
              OR (subject_type = 'message' AND subject_id IN
                    (SELECT id FROM messages WHERE sender_user_id = $1)))`,
        [input.cascadeToUserId, input.outcome, input.reviewerId],
      );
      closed += rest.rowCount ?? 0;
    }
    return { closed };
  });
}
