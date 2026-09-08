import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { verifyPassword } from './password.js';
import { revokeRefreshTokens } from './tokens.js';

export interface ActiveSession {
  deviceId: string;
  platform: string;
  appVersion: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** The device making this request. It must not offer to sign itself out. */
  current: boolean;
}

/**
 * Devices with a live session.
 *
 * The other half of the story the refresh-token replay detection already tells:
 * detecting a stolen token is worth little if the owner has no way to see that
 * a device they lost is still signed in, or to end it.
 *
 * Joined against live refresh tokens rather than listing every device ever
 * seen — a device with no unrevoked token is not a session, and showing it
 * would make "sign out everywhere" look like it did nothing.
 */
export async function listSessions(
  userId: string,
  currentDeviceId?: string,
): Promise<ActiveSession[]> {
  const { rows } = await pool.query<{
    device_id: string;
    platform: string;
    app_version: string | null;
    first_seen_at: Date;
    last_seen_at: Date;
  }>(
    `SELECT DISTINCT ON (d.device_id)
            d.device_id, d.platform, d.app_version, d.first_seen_at, d.last_seen_at
       FROM user_devices d
       JOIN refresh_tokens t
         ON t.user_id = d.user_id
        AND t.device_id = d.device_id
        AND t.revoked_at IS NULL
        AND t.expires_at > now()
      WHERE d.user_id = $1
      ORDER BY d.device_id, d.last_seen_at DESC`,
    [userId],
  );

  return rows
    .map((row) => ({
      deviceId: row.device_id,
      platform: row.platform,
      appVersion: row.app_version,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      current: row.device_id === currentDeviceId,
    }))
    .sort((a, b) => {
      // This device first — it is the one the reader is looking for, to orient
      // themselves before deciding what the other rows are.
      if (a.current !== b.current) return a.current ? -1 : 1;
      return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
    });
}

/** Ends one device's session. Idempotent — revoking an already-dead one is fine. */
export async function revokeSession(userId: string, deviceId: string): Promise<number> {
  return revokeRefreshTokens(userId, deviceId);
}

/**
 * Deletes an account.
 *
 * NOT a row deletion, and it cannot be. The ledger is append-only by design and
 * its entries are immutable at the database level, so removing a user would
 * either fail outright or leave money entries pointing at nothing — which is
 * exactly the state the nightly reconciliation exists to page someone about.
 *
 * So deletion means ANONYMISING the identity while the financial history
 * survives: phone, email, password, display name, avatar and bio are cleared,
 * the status becomes 'deleted', and every session ends. What remains is a row
 * with an id and a money trail, which is what reconciliation, a payout dispute,
 * and the CA's retention period all need.
 *
 * This is required, not optional. Google Play mandates in-app account deletion
 * for any app with accounts, and DPDP Act 2023 adds an erasure right on top.
 */
export async function deleteAccount(input: {
  userId: string;
  /** Required when the account has one — a borrowed unlocked phone must not be able to do this. */
  password?: string;
}): Promise<void> {
  const { rows } = await pool.query<{ password_hash: string | null; status: string }>(
    'SELECT password_hash, status FROM users WHERE id = $1',
    [input.userId],
  );

  const account = rows[0];
  if (!account) throw new AppError('USER_NOT_FOUND', 'Account not found', 404);
  if (account.status === 'deleted') return; // Already gone. Idempotent.

  if (account.password_hash) {
    if (!input.password) {
      throw new AppError('PASSWORD_REQUIRED', 'Enter your password to delete your account', 422);
    }
    if (!(await verifyPassword(input.password, account.password_hash))) {
      throw new AppError('INVALID_CREDENTIALS', 'That password is not correct', 401);
    }
  }

  await withTransaction(async (client) => {
    // Cleared, not deleted. The UNIQUE indexes on phone and email are partial
    // or nullable, so nulling them frees the address for reuse — which matters,
    // because someone deleting an account and signing up again with the same
    // number is ordinary and must not hit a constraint.
    await client.query(
      `UPDATE users
          SET status = 'deleted',
              deleted_at = now(),
              phone_e164 = NULL,
              phone_verified_at = NULL,
              email = NULL,
              email_verified_at = NULL,
              password_hash = NULL
        WHERE id = $1`,
      [input.userId],
    );

    await client.query(
      `UPDATE user_profiles
          SET display_name = NULL, avatar_url = NULL, bio = NULL,
              gender = NULL, date_of_birth = NULL
        WHERE user_id = $1`,
      [input.userId],
    );

    // Push tokens are personal data and a delivery channel. Both reasons to go.
    await client.query('DELETE FROM user_devices WHERE user_id = $1', [input.userId]);

    // Pending codes would otherwise still be spendable against a dead account.
    await client.query(
      `UPDATE email_verifications SET consumed_at = now()
        WHERE user_id = $1 AND consumed_at IS NULL`,
      [input.userId],
    );
  });

  await revokeRefreshTokens(input.userId);

  // Deliberately loud and permanent in the log. A deletion dispute is resolved
  // by knowing exactly when it happened, and the row itself no longer says.
  logger.warn('account deleted', { user_id: input.userId });
}
