// Moving an account to a different phone number.
//
// The last hole in the recovery story. An account is reachable at exactly one
// number, that number is what the payout identity eventually hangs off, and
// changing SIM is ordinary in India — numbers are cheap and churn is high. A
// user who could not move their number was one lost SIM away from an account
// nobody could sign into and support could not fix.
//
// THE THREAT THIS IS BUILT AGAINST is not a stranger on the internet. It is
// someone holding an unlocked phone that is already signed in — a partner, a
// colleague, a thief with a shoulder-surfed PIN. Changing the number is the
// first thing an attacker does after getting in, because it converts temporary
// access into permanent ownership. So:
//
//   · the account password is required when there is one;
//   · the NEW number is proved by OTP, so a typo cannot strand the account;
//   · every other device is signed out, because a number change is a security
//     event whether or not the person doing it meant it as one;
//   · it is written to phone_changes and logged at warn, permanently, because
//     the support ticket that follows a takeover starts with "when did my
//     number change, and from which device".

import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import type { OtpChannel } from './otp.provider.js';
import { assertValidPhone, requestOtp, verifyOtp } from './otp.service.js';
import { verifyPassword } from './password.js';
import { revokeRefreshTokens } from './tokens.js';

interface Account {
  phone_e164: string | null;
  password_hash: string | null;
}

async function loadAccount(userId: string): Promise<Account> {
  const { rows } = await pool.query<Account>(
    'SELECT phone_e164, password_hash FROM users WHERE id = $1',
    [userId],
  );
  if (!rows[0]) throw new AppError('USER_NOT_FOUND', 'Account not found', 404);
  return rows[0];
}

/**
 * Refuses a number that already belongs to someone.
 *
 * Checked BEFORE the code is sent, not after. Sending first would mean anyone
 * signed in could make us text an arbitrary stranger on demand — a harassment
 * channel and a way to burn the DLT quota, both worse than what this check
 * costs.
 *
 * What it costs is an existence signal: a caller learns whether a number has an
 * account. That is narrow — the endpoint is authenticated and rate-limited per
 * user, so it is not an open oracle — and it is the trade every app of this
 * kind makes. Worth stating plainly rather than pretending it is free.
 */
async function assertPhoneIsFree(phoneE164: string, userId: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE phone_e164 = $1',
    [phoneE164],
  );

  const owner = rows[0];
  if (!owner) return;

  if (owner.id === userId) {
    throw new AppError('PHONE_UNCHANGED', 'That is already your number', 409);
  }
  throw new AppError('PHONE_TAKEN', 'Another account already uses this number', 409);
}

/**
 * Step one: prove the account, then send a code to the NEW number.
 *
 * The code goes to the number being moved TO, not the one being moved from.
 * Sending to the old number would be the more paranoid design and it is the
 * wrong one here: the commonest reason to change is that the old SIM is gone,
 * and a flow that requires the thing you lost is a flow nobody can complete.
 * The password is what re-proves the account instead.
 */
export async function requestPhoneChange(input: {
  userId: string;
  phoneE164: string;
  channel?: OtpChannel;
  /** Required when the account has a password. Ignored when it has none. */
  password?: string;
}): Promise<Awaited<ReturnType<typeof requestOtp>>> {
  assertValidPhone(input.phoneE164);

  const account = await loadAccount(input.userId);

  if (account.password_hash) {
    if (!input.password) {
      throw new AppError('PASSWORD_REQUIRED', 'Enter your password to change your number', 422);
    }
    if (!(await verifyPassword(input.password, account.password_hash))) {
      throw new AppError('INVALID_CREDENTIALS', 'That password is not correct', 401);
    }
  }

  await assertPhoneIsFree(input.phoneE164, input.userId);

  return requestOtp(input.phoneE164, input.channel ?? 'whatsapp', 'phone_change');
}

/**
 * Step two: check the code and move the number.
 *
 * The free-number check runs AGAIN inside the transaction. Between the request
 * and the verify — minutes, in practice — someone else can sign up with that
 * number, and the first check would then be stale. The UNIQUE index would catch
 * it either way, but as a constraint violation rather than a sentence anyone
 * can act on.
 */
export async function confirmPhoneChange(input: {
  userId: string;
  phoneE164: string;
  code: string;
  /** Kept signed in. Everything else is signed out. */
  keepDeviceId?: string;
}): Promise<{ phone: string }> {
  assertValidPhone(input.phoneE164);

  const before = await loadAccount(input.userId);
  await assertPhoneIsFree(input.phoneE164, input.userId);

  // Throws on a wrong code, and the attempt counter has already committed —
  // see the note in otp.service.ts about why that ordering is load-bearing.
  await verifyOtp(input.phoneE164, input.code, 'phone_change');

  await withTransaction(async (client) => {
    // Re-checked under the row lock: two devices confirming two different
    // numbers at once must not interleave into a lost update.
    const { rows } = await client.query<{ phone_e164: string | null }>(
      'SELECT phone_e164 FROM users WHERE id = $1 FOR UPDATE',
      [input.userId],
    );
    if (!rows[0]) throw new AppError('USER_NOT_FOUND', 'Account not found', 404);

    const taken = await client.query('SELECT 1 FROM users WHERE phone_e164 = $1 AND id <> $2', [
      input.phoneE164,
      input.userId,
    ]);
    if (taken.rowCount! > 0) {
      throw new AppError('PHONE_TAKEN', 'Another account already uses this number', 409);
    }

    await client.query(
      `UPDATE users SET phone_e164 = $2, phone_verified_at = now() WHERE id = $1`,
      [input.userId, input.phoneE164],
    );

    await client.query(
      `INSERT INTO phone_changes (id, user_id, old_phone, new_phone, device_id)
            VALUES ($1, $2, $3, $4, $5)`,
      [uuidv7(), input.userId, rows[0].phone_e164, input.phoneE164, input.keepDeviceId ?? null],
    );
  });

  // Other devices lose their session. If this change was not the owner's doing,
  // signing the attacker out is the only thing that still helps them.
  await revokeOtherDevices(input.userId, input.keepDeviceId);

  // Warn, not info, and permanent. A takeover investigation starts here.
  logger.warn('phone number changed', {
    user_id: input.userId,
    // The OLD number only. Logging both would put a live credential-adjacent
    // identifier in a log that is shipped off the box.
    old_phone: before.phone_e164,
    device_id: input.keepDeviceId,
  });

  return { phone: input.phoneE164 };
}

async function revokeOtherDevices(userId: string, keepDeviceId?: string): Promise<void> {
  if (keepDeviceId === undefined) {
    await revokeRefreshTokens(userId);
    return;
  }

  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE user_id = $1 AND device_id IS DISTINCT FROM $2 AND revoked_at IS NULL`,
    [userId, keepDeviceId],
  );
}
