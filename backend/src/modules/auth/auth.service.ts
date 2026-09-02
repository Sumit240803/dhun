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
  /** Display name AND date of birth are both set — the signup flow is finished. */
  profileComplete: boolean;
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
      // A brand-new guest has neither, so this is false by construction rather
      // than by a query that would always return the same answer.
      user: {
        id: userId,
        status: 'guest',
        phone: null,
        displayName: null,
        profileComplete: false,
        roles: [],
      },
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
    date_of_birth: Date | null;
  }>(
    'SELECT u.id, u.status, u.phone_e164, p.display_name, p.date_of_birth' +
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
    /**
     * Has the profile step actually been finished?
     *
     * A BOOLEAN rather than the date itself: the client only needs to know
     * whether to show the step, and a date of birth is the kind of field that
     * should not travel further than the one check that needs it.
     *
     * This exists because the client had no way to ask. Someone who quit the
     * app mid-signup came back authenticated, went straight to the feed, and
     * was never asked again — leaving a registered account with no name and no
     * date of birth, which then failed every money endpoint with DOB_REQUIRED
     * and no way to fix it.
     */
    profileComplete: rows[0].display_name !== null && rows[0].date_of_birth !== null,
    roles: await getRoles(userId),
  };
}

export async function getSessionUser(userId: string): Promise<SessionUser> {
  return withTransaction((client) => loadSessionUser(client, userId));
}

/** Minimum age for the whole platform. Hard rule #5 — a minor host is existential risk. */
const MIN_AGE_YEARS = 18;

/** IST is UTC+5:30 with no daylight saving, so the offset is a constant. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

interface CalendarDate {
  y: number;
  m: number;
  d: number;
}

/**
 * Parses 'YYYY-MM-DD' as a calendar date, rejecting dates that do not exist.
 *
 * The route's regex only checks the SHAPE, so '2008-02-31' and '2008-13-01'
 * both reach here. Round-tripping through UTC is what catches them.
 */
function parseCalendarDate(value: string): CalendarDate | null {
  const [y, m, d] = value.split('-').map(Number);
  const roundTrip = new Date(Date.UTC(y, m - 1, d));
  if (
    roundTrip.getUTCFullYear() !== y ||
    roundTrip.getUTCMonth() + 1 !== m ||
    roundTrip.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

/** Today in IST, as a calendar date. The platform's business day is Indian. */
function todayIst(nowMs: number): CalendarDate {
  const shifted = new Date(nowMs + IST_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  };
}

/**
 * Age in whole years, from calendar dates only.
 *
 * NEVER via Date getters on a parsed 'YYYY-MM-DD'. That string parses as UTC
 * midnight while getMonth()/getDate() read LOCAL time, so on any server west of
 * UTC every birthday lands a day early and a 17-year-old clears the gate the
 * day before turning 18. Hard rule #5 does not tolerate an off-by-one, and the
 * bug is invisible in India — it only appears once a server moves.
 */
function ageInYears(dob: CalendarDate, today: CalendarDate): number {
  const beforeBirthday = today.m < dob.m || (today.m === dob.m && today.d < dob.d);
  return today.y - dob.y - (beforeBirthday ? 1 : 0);
}

export async function updateProfile(
  userId: string,
  patch: { displayName?: string; avatarUrl?: string; bio?: string; gender?: string; dateOfBirth?: string },
): Promise<SessionUser> {
  if (patch.dateOfBirth) {
    const dob = parseCalendarDate(patch.dateOfBirth);
    if (dob === null) {
      throw new AppError('INVALID_DOB', 'Date of birth is not a valid date', 422);
    }

    const today = todayIst(Date.now());
    const age = ageInYears(dob, today);

    // A future date of birth is malformed input, not a young user. Reporting it
    // as UNDERAGE would send someone to an age-appeal flow for a typo.
    if (age < 0) {
      throw new AppError('INVALID_DOB', 'Date of birth is not a valid date', 422);
    }
    if (age < MIN_AGE_YEARS) {
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
