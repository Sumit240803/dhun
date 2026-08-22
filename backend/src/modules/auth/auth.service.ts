// Sign-in, sign-up, and the guest upgrade.

import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { getRoles, RoleGrant } from './permissions.js';
import { verifyOtp } from './otp.service.js';
import { issueTokenPair, TokenPair } from './tokens.js';

export interface DeviceInfo {
  deviceId: string;
  platform: 'android' | 'ios' | 'web';
  appVersion?: string;
  pushToken?: string;
}

export interface SessionUser {
  id: string;
  status: string;
  phone: string | null;
  displayName: string | null;
  roles: RoleGrant[];
}

async function upsertDevice(client: PoolClient, userId: string, device: DeviceInfo) {
  await client.query(
    'INSERT INTO user_devices (id, user_id, device_id, platform, app_version, push_token)' +
      ' VALUES ($1,$2,$3,$4,$5,$6)' +
      ' ON CONFLICT (user_id, device_id) DO UPDATE' +
      '   SET last_seen_at = now(),' +
      '       app_version = COALESCE(EXCLUDED.app_version, user_devices.app_version),' +
      '       push_token = COALESCE(EXCLUDED.push_token, user_devices.push_token)',
    [
      uuidv7(),
      userId,
      device.deviceId,
      device.platform,
      device.appVersion ?? null,
      device.pushToken ?? null,
    ],
  );
}

/**
 * Guests are real rows, not a client-side fiction.
 *
 * That is what lets a user browse, watch and earn free coins before signing up,
 * then keep all of it — the same row gains a phone number rather than being
 * replaced, so nothing recorded before signup is orphaned.
 */
export async function createGuest(device: DeviceInfo): Promise<{ user: SessionUser } & TokenPair> {
  return withTransaction(async (client) => {
    const userId = uuidv7();
    await client.query("INSERT INTO users (id, status) VALUES ($1, 'guest')", [userId]);
    await client.query('INSERT INTO user_profiles (user_id) VALUES ($1)', [userId]);
    await upsertDevice(client, userId, device);

    const tokens = await issueTokenPair(client, userId, 'guest', device.deviceId);
    return {
      user: { id: userId, status: 'guest', phone: null, displayName: null, roles: [] },
      ...tokens,
    };
  });
}

/**
 * Completes phone verification.
 *
 * Three cases:
 *   · phone already registered  → sign in to that account
 *   · new phone, guest calling  → upgrade the guest IN PLACE, keeping their id
 *   · new phone, no guest       → create a fresh registered user
 */
export async function verifyPhoneAndSignIn(input: {
  phoneE164: string;
  code: string;
  device: DeviceInfo;
  /** From the caller's access token, when they were browsing as a guest. */
  guestUserId?: string;
}): Promise<{ user: SessionUser; isNewUser: boolean } & TokenPair> {
  await verifyOtp(input.phoneE164, input.code);

  return withTransaction(async (client) => {
    const { rows: existing } = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM users WHERE phone_e164 = $1',
      [input.phoneE164],
    );

    let userId: string;
    let isNewUser = false;

    if (existing[0]) {
      if (existing[0].status === 'banned') {
        throw new AppError('ACCOUNT_BANNED', 'This account has been permanently banned', 403);
      }
      userId = existing[0].id;

      // The guest was browsing on a device that already has an account. Their
      // guest row is left intact rather than merged — merging balances between
      // two identities is how double-spend bugs and laundering routes appear.
      if (input.guestUserId && input.guestUserId !== userId) {
        logger.info('guest signed into an existing account', {
          guest_id: input.guestUserId,
          user_id: userId,
        });
      }
    } else if (input.guestUserId) {
      const { rowCount } = await client.query(
        "UPDATE users SET phone_e164 = $2, phone_verified_at = now(), status = 'active'" +
          " WHERE id = $1 AND status = 'guest'",
        [input.guestUserId, input.phoneE164],
      );
      if (!rowCount) {
        throw new AppError('GUEST_NOT_FOUND', 'That guest session is no longer valid', 409);
      }
      userId = input.guestUserId;
      isNewUser = true;
    } else {
      userId = uuidv7();
      await client.query(
        "INSERT INTO users (id, status, phone_e164, phone_verified_at) VALUES ($1,'active',$2, now())",
        [userId, input.phoneE164],
      );
      await client.query('INSERT INTO user_profiles (user_id) VALUES ($1)', [userId]);
      isNewUser = true;
    }

    await upsertDevice(client, userId, input.device);
    const tokens = await issueTokenPair(client, userId, 'active', input.device.deviceId);
    const user = await loadSessionUser(client, userId);

    return { user, isNewUser, ...tokens };
  });
}

async function loadSessionUser(client: PoolClient, userId: string): Promise<SessionUser> {
  const { rows } = await client.query<{
    id: string;
    status: string;
    phone_e164: string | null;
    display_name: string | null;
  }>(
    'SELECT u.id, u.status, u.phone_e164, p.display_name' +
      ' FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id' +
      ' WHERE u.id = $1',
    [userId],
  );
  if (!rows[0]) throw new AppError('USER_NOT_FOUND', 'User not found', 404);

  return {
    id: rows[0].id,
    status: rows[0].status,
    phone: rows[0].phone_e164,
    displayName: rows[0].display_name,
    roles: await getRoles(userId),
  };
}

export async function getSessionUser(userId: string): Promise<SessionUser> {
  return withTransaction((client) => loadSessionUser(client, userId));
}

/** Minimum age for the whole platform. Hard rule #5 — a minor host is existential risk. */
const MIN_AGE_YEARS = 18;

function ageOn(dob: Date, at: Date): number {
  let age = at.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    at.getMonth() < dob.getMonth() ||
    (at.getMonth() === dob.getMonth() && at.getDate() < dob.getDate());
  return beforeBirthday ? age - 1 : age;
}

export async function updateProfile(
  userId: string,
  patch: { displayName?: string; avatarUrl?: string; bio?: string; gender?: string; dateOfBirth?: string },
): Promise<SessionUser> {
  if (patch.dateOfBirth) {
    const dob = new Date(patch.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      throw new AppError('INVALID_DOB', 'Date of birth is not a valid date', 422);
    }
    if (ageOn(dob, new Date()) < MIN_AGE_YEARS) {
      throw new AppError('UNDERAGE', 'You must be 18 or older to use this app', 403);
    }
  }

  return withTransaction(async (client) => {
    await client.query(
      'UPDATE user_profiles SET' +
        '  display_name  = COALESCE($2, display_name),' +
        '  avatar_url    = COALESCE($3, avatar_url),' +
        '  bio           = COALESCE($4, bio),' +
        '  gender        = COALESCE($5, gender),' +
        '  date_of_birth = COALESCE($6::date, date_of_birth)' +
        ' WHERE user_id = $1',
      [
        userId,
        patch.displayName ?? null,
        patch.avatarUrl ?? null,
        patch.bio ?? null,
        patch.gender ?? null,
        patch.dateOfBirth ?? null,
      ],
    );
    return loadSessionUser(client, userId);
  });
}
