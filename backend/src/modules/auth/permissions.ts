// The single permission check. Every authorisation decision goes through here.
//
// app-blueprint-v1 bans a users.role column, and for good reason: one person is
// simultaneously a viewer, a host, a room admin in three rooms, and possibly an
// agency manager. Roles are therefore scoped assignments, revoked by setting
// revoked_at rather than by deleting.

import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';

export type ScopeType = 'global' | 'room' | 'agency';

export interface RoleGrant {
  roleCode: string;
  scopeType: ScopeType;
  scopeId: string | null;
}

export async function getRoles(userId: string): Promise<RoleGrant[]> {
  const { rows } = await pool.query<{
    role_code: string;
    scope_type: ScopeType;
    scope_id: string | null;
  }>(
    'SELECT role_code, scope_type, scope_id FROM role_assignments' +
      ' WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rows.map((r) => ({
    roleCode: r.role_code,
    scopeType: r.scope_type,
    scopeId: r.scope_id,
  }));
}

/**
 * Does this user hold this role?
 *
 * A global grant satisfies a scoped check — a super_admin is an admin of every
 * room without needing a row per room. The reverse is not true.
 */
export async function hasRole(
  userId: string,
  roleCode: string,
  scope?: { type: Exclude<ScopeType, 'global'>; id: string },
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    'SELECT EXISTS (' +
      '  SELECT 1 FROM role_assignments' +
      '   WHERE user_id = $1 AND role_code = $2 AND revoked_at IS NULL' +
      "     AND (scope_type = 'global'" +
      '          OR ($3::text IS NOT NULL AND scope_type = $3 AND scope_id = $4::uuid))' +
      ') AS ok',
    [userId, roleCode, scope?.type ?? null, scope?.id ?? null],
  );
  return rows[0].ok;
}

export async function assertRole(
  userId: string,
  roleCode: string,
  scope?: { type: Exclude<ScopeType, 'global'>; id: string },
): Promise<void> {
  if (!(await hasRole(userId, roleCode, scope))) {
    throw new AppError('FORBIDDEN', `Requires the "${roleCode}" role`, 403, {
      role: roleCode,
      ...(scope ? { scope } : {}),
    });
  }
}

export async function grantRole(input: {
  userId: string;
  roleCode: string;
  scopeType: ScopeType;
  scopeId?: string | null;
  grantedBy?: string;
  reason?: string;
}): Promise<void> {
  const { uuidv7 } = await import('uuidv7');
  await pool.query(
    'INSERT INTO role_assignments (id, user_id, role_code, scope_type, scope_id, granted_by, reason)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7)' +
      ' ON CONFLICT DO NOTHING',
    [
      uuidv7(),
      input.userId,
      input.roleCode,
      input.scopeType,
      input.scopeId ?? null,
      input.grantedBy ?? null,
      input.reason ?? null,
    ],
  );
}

/** Revoke = stamp revoked_at. Never DELETE — the grant history is the audit trail. */
export async function revokeRole(input: {
  userId: string;
  roleCode: string;
  scopeId?: string | null;
  revokedBy?: string;
}): Promise<void> {
  await pool.query(
    'UPDATE role_assignments SET revoked_at = now(), revoked_by = $4' +
      ' WHERE user_id = $1 AND role_code = $2' +
      ' AND scope_id IS NOT DISTINCT FROM $3 AND revoked_at IS NULL',
    [input.userId, input.roleCode, input.scopeId ?? null, input.revokedBy ?? null],
  );
}
