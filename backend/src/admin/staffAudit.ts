// No default credential, anywhere (build-plan M21 slice 6).
//
// The development database has carried a staff account with a typed-in
// password since the panel was built. A copy of that database, a seed script
// run against the wrong host, or a hurried "I'll change it later" is how a
// back office that can suspend accounts and end rooms ends up open to anyone
// who has read a tutorial. Staff accounts are created only by
// scripts/staff.ts, with a generated password; this is the check that the
// rule held.
//
// At every API start in a deployed environment, each active staff account's
// password is tried against a short list of known and obvious ones. One match
// pages, names the account (an id, never a credential), and is recorded.
// Slow on purpose (scrypt per guess), so it runs in the background after the
// server is already listening.

import { alert } from '../infra/alerts.js';
import { pool } from '../infra/db.js';
import { logger } from '../infra/logger.js';
import { verifyPassword } from '../modules/auth/password.js';
import { STAFF_ROLES } from './session.js';

/** The ones this repo has used, and the ones every scanner tries first. */
export const KNOWN_PASSWORDS = [
  'admin-dev-password',
  'correct horse battery staple',
  'admin',
  'admin123',
  'admin@123',
  'password',
  'password123',
  'changeme',
  'dhun',
  'dhun123',
  'dhun@123',
  'dhunlive',
  '12345678',
];

export interface StaffAuditResult {
  checked: number;
  weak: { userId: string; roles: string[] }[];
}

export async function auditStaffCredentials(candidates = KNOWN_PASSWORDS): Promise<StaffAuditResult> {
  try {
    const { rows } = await pool.query<{ user_id: string; password_hash: string; roles: string[] }>(
      `SELECT u.id AS user_id, u.password_hash, array_agg(DISTINCT r.role_code) AS roles
         FROM users u
         JOIN role_assignments r ON r.user_id = u.id
        WHERE r.revoked_at IS NULL
          AND r.role_code = ANY($1::text[])
          AND u.password_hash IS NOT NULL
          AND u.status = 'active'
        GROUP BY u.id, u.password_hash`,
      [STAFF_ROLES],
    );

    const weak: StaffAuditResult['weak'] = [];
    for (const row of rows) {
      for (const guess of candidates) {
        if (await verifyPassword(guess, row.password_hash)) {
          weak.push({ userId: row.user_id, roles: row.roles });
          break;
        }
      }
    }

    if (weak.length > 0) {
      await alert({
        severity: 'page',
        key: 'staff_known_password',
        title: `${weak.length} staff account(s) use a known password`,
        detail: {
          accounts: weak.map((w) => `${w.userId} (${w.roles.join(', ')})`).join('; '),
          fix: 'Revoke the role with scripts/staff.ts and create the person again; it generates the password.',
        },
      });
    } else {
      logger.info('staff credential audit passed', { checked: rows.length });
    }
    return { checked: rows.length, weak };
  } catch (err) {
    logger.error('staff credential audit failed', err);
    return { checked: 0, weak: [] };
  }
}
