// Free coins: the welcome bonus, the daily check-in streak, watching, referrals.
//
// Every one of these is real money — ordinary coins that gift to hosts at the
// full payout rate — so every one is:
//
//   · once-only by construction. The ledger idempotency key is DERIVED FROM THE
//     CLAIM (`checkin:{user}:{date}`), never taken from a client header, and a
//     `reward_claims` row with that key as its primary key is written inside
//     the same transaction. Asking twice cannot pay twice (§ C5b).
//   · capped per IST day, because India's day does not end at 05:30.
//   · configurable, because the economy doc's answer to free-coin cost passing
//     8% of revenue is to cut these amounts — without a release.
//   · for registered accounts only. Guests cannot spend, and coins handed to
//     accounts that cannot spend them are a liability with no purpose.

import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import {
  ECONOMY,
  freeCoinGrantLegs,
  getConfigValue,
  postTransaction,
} from '../economy/index.js';

// ── Config ──────────────────────────────────────────────────────────────────

const freeCoinsSchema = z.object({
  signup: z.number().int().min(0),
  checkinLadder: z.array(z.number().int().min(0)).length(7),
  watch: z.object({
    coins: z.number().int().min(0),
    minutes: z.number().int().min(1),
    dailyCap: z.number().int().min(0),
  }),
  referral: z.object({
    coins: z.number().int().min(0),
    minPurchasePaise: z.number().int().min(0),
    attachWindowDays: z.number().int().min(0),
  }),
});

export type FreeCoinsConfig = z.infer<typeof freeCoinsSchema>;

/** The seeded values, used only if the config row is missing or malformed. */
const DEFAULTS: FreeCoinsConfig = {
  signup: 500,
  checkinLadder: [20, 30, 40, 60, 80, 100, 150],
  watch: { coins: 30, minutes: 5, dailyCap: 10 },
  referral: { coins: 2_000, minPurchasePaise: 9_900, attachWindowDays: 7 },
};

export async function freeCoinsConfig(): Promise<FreeCoinsConfig> {
  const parsed = freeCoinsSchema.safeParse(await getConfigValue('free_coins'));
  if (!parsed.success) {
    logger.error('app_config.free_coins is invalid; using defaults', {
      issues: parsed.error.issues.length,
    });
    return DEFAULTS;
  }
  return parsed.data;
}

// ── Dates ───────────────────────────────────────────────────────────────────

/** The IST calendar date, YYYY-MM-DD. */
export function istDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

// ── The one way coins are granted ───────────────────────────────────────────

type ClaimKind = 'signup' | 'checkin' | 'watch' | 'referral';

interface Grant {
  userId: string;
  kind: ClaimKind;
  claimKey: string;
  coins: number;
  dayIst: string;
  streakDay?: number;
  /** Anything else the claim must do in the same transaction. */
  alsoInTransaction?: (client: PoolClient) => Promise<void>;
}

async function grant(input: Grant): Promise<{ coins: number; replayed: boolean }> {
  const result = await postTransaction({
    txnType: 'free_coin_grant',
    idempotencyKey: input.claimKey,
    identity: { source: input.kind, claim: input.claimKey },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
    },
    actorUserId: input.userId,
    legs: freeCoinGrantLegs({ userId: input.userId, coins: input.coins }),
    withinTransaction: async (client, txnId) => {
      await client.query(
        `INSERT INTO reward_claims (claim_key, user_id, kind, coins, day_ist, streak_day, txn_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.claimKey,
          input.userId,
          input.kind,
          input.coins,
          input.dayIst,
          input.streakDay ?? null,
          txnId,
        ],
      );
      await input.alsoInTransaction?.(client);
    },
    events: [
      {
        // The event taxonomy's name for it (data-and-launch-plan-v1).
        eventType: 'free_coins_earned',
        partitionKey: input.userId,
        payload: {
          user_id: input.userId,
          source: input.kind,
          coins: input.coins,
          streak_day: input.streakDay ?? null,
        },
      },
    ],
    response: { coins: input.coins, kind: input.kind },
  });

  return { coins: Number(result.response.coins ?? input.coins), replayed: result.replayed };
}

// ── Welcome bonus ───────────────────────────────────────────────────────────

/**
 * Whether another account on one of this user's devices already took it.
 *
 * Device ids are client-generated, so this stops the casual farm — reinstall,
 * new number, claim again — rather than a determined one. The determined one
 * is M9's fraud work; this keeps it from being free.
 */
async function welcomeTakenOnDevice(userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM user_devices mine
       JOIN user_devices theirs ON theirs.device_id = mine.device_id AND theirs.user_id <> mine.user_id
       JOIN reward_claims rc ON rc.user_id = theirs.user_id AND rc.kind = 'signup'
      WHERE mine.user_id = $1
      LIMIT 1`,
    [userId],
  );
  return rowCount! > 0;
}

export async function claimWelcome(userId: string): Promise<{ coins: number; alreadyClaimed: boolean }> {
  const config = await freeCoinsConfig();
  if (config.signup === 0) {
    throw new AppError('REWARD_UNAVAILABLE', 'This reward is not available right now', 409);
  }

  const claimKey = `signup:${userId}`;
  const existing = await claimExists(claimKey);
  if (existing) return { coins: existing.coins, alreadyClaimed: true };

  if (await welcomeTakenOnDevice(userId)) {
    throw new AppError(
      'WELCOME_ALREADY_USED_ON_DEVICE',
      'The welcome bonus has already been claimed on this phone',
      409,
    );
  }

  const result = await grant({
    userId,
    kind: 'signup',
    claimKey,
    coins: config.signup,
    dayIst: istDate(),
  });
  return { coins: result.coins, alreadyClaimed: result.replayed };
}

// ── Daily check-in ──────────────────────────────────────────────────────────

async function claimExists(claimKey: string): Promise<{ coins: number; streakDay: number | null } | null> {
  const { rows } = await pool.query<{ coins: string; streak_day: number | null }>(
    'SELECT coins, streak_day FROM reward_claims WHERE claim_key = $1',
    [claimKey],
  );
  return rows[0] ? { coins: Number(rows[0].coins), streakDay: rows[0].streak_day } : null;
}

/**
 * Which day of the ladder today would be.
 *
 * Yesterday's claim continues the streak and day 7 wraps to day 1; a missed IST
 * day starts over at day 1. Computed from yesterday's row rather than stored as
 * a running counter, so it can never disagree with the claims that exist.
 */
async function nextStreakDay(userId: string, today: string): Promise<number> {
  const yesterday = await claimExists(`checkin:${userId}:${previousDay(today)}`);
  return yesterday?.streakDay ? (yesterday.streakDay % 7) + 1 : 1;
}

export async function claimCheckin(
  userId: string,
  today: string = istDate(),
): Promise<{ coins: number; streakDay: number; alreadyClaimed: boolean }> {
  const claimKey = `checkin:${userId}:${today}`;
  const existing = await claimExists(claimKey);
  if (existing) {
    return { coins: existing.coins, streakDay: existing.streakDay ?? 1, alreadyClaimed: true };
  }

  const config = await freeCoinsConfig();
  const streakDay = await nextStreakDay(userId, today);
  const coins = config.checkinLadder[streakDay - 1];
  if (coins === 0) {
    throw new AppError('REWARD_UNAVAILABLE', 'This reward is not available right now', 409);
  }

  const result = await grant({
    userId,
    kind: 'checkin',
    claimKey,
    coins,
    dayIst: today,
    streakDay,
  });
  return { coins: result.coins, streakDay, alreadyClaimed: result.replayed };
}

// ── Watching ────────────────────────────────────────────────────────────────

/**
 * Credits one watch interval, if today's cap allows.
 *
 * Called by the GATEWAY, which is the only thing that knows a socket actually
 * sat in a room for the interval — a client-reported heartbeat would pay
 * anyone who scripted one. Returns null when capped or when a concurrent call
 * took the same slot first.
 */
export async function grantWatchReward(
  userId: string,
  today: string = istDate(),
): Promise<{ coins: number; earnedToday: number; dailyCap: number } | null> {
  const config = await freeCoinsConfig();
  if (config.watch.coins === 0) return null;

  const { rows } = await pool.query<{ count: string; status: string }>(
    `SELECT (SELECT count(*) FROM reward_claims
              WHERE user_id = $1 AND kind = 'watch' AND day_ist = $2) AS count,
            (SELECT status FROM users WHERE id = $1) AS status`,
    [userId, today],
  );
  if (rows[0]?.status !== 'active') return null;

  const earned = Number(rows[0].count);
  if (earned >= config.watch.dailyCap) return null;

  const slot = earned + 1;
  const result = await grant({
    userId,
    kind: 'watch',
    // The slot number is part of the key: two racing calls for slot 4 collide
    // on the key and only one pays, and neither can ever claim slot 11.
    claimKey: `watch:${userId}:${today}:${slot}`,
    coins: config.watch.coins,
    dayIst: today,
  });
  if (result.replayed) return null;

  return { coins: result.coins, earnedToday: slot, dailyCap: config.watch.dailyCap };
}

// ── Referrals ───────────────────────────────────────────────────────────────

export async function attachReferral(userId: string, code: string): Promise<{ referrerName: string | null }> {
  const config = await freeCoinsConfig();

  if (!/^\d{1,18}$/.test(code)) {
    throw new AppError('REFERRAL_CODE_INVALID', 'That invite code does not exist', 404);
  }

  const { rows } = await pool.query<{
    referrer_id: string | null;
    referrer_name: string | null;
    referrer_status: string | null;
    account_age_days: number;
    already_referred: boolean;
    shares_device: boolean;
  }>(
    `SELECT r.id AS referrer_id,
            rp.display_name AS referrer_name,
            r.status AS referrer_status,
            EXTRACT(EPOCH FROM (now() - me.created_at)) / 86400 AS account_age_days,
            EXISTS (SELECT 1 FROM referrals WHERE referred_user_id = me.id) AS already_referred,
            EXISTS (SELECT 1 FROM user_devices a
                      JOIN user_devices b ON b.device_id = a.device_id
                     WHERE a.user_id = me.id AND b.user_id = r.id) AS shares_device
       FROM users me
       LEFT JOIN users r ON r.public_id = $2::bigint
       LEFT JOIN user_profiles rp ON rp.user_id = r.id
      WHERE me.id = $1`,
    [userId, code],
  );

  const row = rows[0];
  if (!row?.referrer_id || row.referrer_status !== 'active') {
    throw new AppError('REFERRAL_CODE_INVALID', 'That invite code does not exist', 404);
  }
  if (row.referrer_id === userId) {
    throw new AppError('REFERRAL_SELF', 'You cannot use your own invite code', 422);
  }
  if (row.already_referred) {
    throw new AppError('REFERRAL_ALREADY_SET', 'You have already used an invite code', 409);
  }
  if (Number(row.account_age_days) > config.referral.attachWindowDays) {
    throw new AppError(
      'REFERRAL_WINDOW_CLOSED',
      'Invite codes can only be used by new accounts',
      409,
      { days: config.referral.attachWindowDays },
    );
  }
  // One phone, two accounts, inviting itself. Refused with the same code as an
  // invalid one would be too obvious a hint; this one is named, because a
  // family sharing a phone deserves to know why.
  if (row.shares_device) {
    throw new AppError('REFERRAL_NOT_ALLOWED', 'Invites cannot come from an account on this phone', 422);
  }

  await pool.query(
    'INSERT INTO referrals (referred_user_id, referrer_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, row.referrer_id],
  );
  return { referrerName: row.referrer_name };
}

/**
 * Pays a referrer, if this purchase is the one that qualifies.
 *
 * Called by the workers' outbox consumer for every `purchase_completed` — so
 * at least once, possibly more. Safe to repeat: the claim key is the referred
 * user, so a referrer is paid once per friend, ever.
 */
export async function rewardReferral(event: { userId: string; amountPaise: number }): Promise<boolean> {
  const config = await freeCoinsConfig();
  if (config.referral.coins === 0 || event.amountPaise < config.referral.minPurchasePaise) {
    return false;
  }

  const { rows } = await pool.query<{ referrer_user_id: string; status: string }>(
    `SELECT r.referrer_user_id, u.status
       FROM referrals r
       JOIN users u ON u.id = r.referrer_user_id
      WHERE r.referred_user_id = $1 AND r.rewarded_at IS NULL`,
    [event.userId],
  );
  const referral = rows[0];
  // A banned or deleted referrer is not paid — and the row stays unrewarded,
  // which is the honest record of what happened.
  if (!referral || referral.status !== 'active') return false;

  const result = await grant({
    userId: referral.referrer_user_id,
    kind: 'referral',
    claimKey: `referral:${event.userId}`,
    coins: config.referral.coins,
    dayIst: istDate(),
    alsoInTransaction: async (client) => {
      await client.query('UPDATE referrals SET rewarded_at = now() WHERE referred_user_id = $1', [
        event.userId,
      ]);
    },
  });
  return !result.replayed;
}

// ── Status ──────────────────────────────────────────────────────────────────

export interface RewardsStatus {
  welcome: { coins: number; claimed: boolean; available: boolean };
  checkin: {
    ladder: number[];
    claimedToday: boolean;
    /** Today's ladder day if claimed, otherwise the day a claim now would be. */
    streakDay: number;
  };
  watch: { coins: number; minutes: number; dailyCap: number; earnedToday: number };
  referral: {
    code: string;
    coins: number;
    minPurchasePaise: number;
    invited: number;
    rewarded: number;
    /** Whether this account may still enter someone else's code. */
    canEnterCode: boolean;
    referredBy: string | null;
  };
}

export async function rewardsStatus(userId: string, today: string = istDate()): Promise<RewardsStatus> {
  const config = await freeCoinsConfig();

  const { rows } = await pool.query<{
    public_id: string;
    account_age_days: number;
    welcome_claimed: boolean;
    today_streak: number | null;
    watch_today: string;
    invited: string;
    rewarded: string;
    referred_by: string | null;
    is_referred: boolean;
  }>(
    `SELECT u.public_id,
            EXTRACT(EPOCH FROM (now() - u.created_at)) / 86400 AS account_age_days,
            EXISTS (SELECT 1 FROM reward_claims WHERE claim_key = 'signup:' || u.id) AS welcome_claimed,
            (SELECT streak_day FROM reward_claims
              WHERE claim_key = 'checkin:' || u.id || ':' || $2) AS today_streak,
            (SELECT count(*) FROM reward_claims
              WHERE user_id = u.id AND kind = 'watch' AND day_ist = $2::date) AS watch_today,
            (SELECT count(*) FROM referrals WHERE referrer_user_id = u.id) AS invited,
            (SELECT count(*) FROM referrals
              WHERE referrer_user_id = u.id AND rewarded_at IS NOT NULL) AS rewarded,
            (SELECT p.display_name FROM referrals rf
               JOIN user_profiles p ON p.user_id = rf.referrer_user_id
              WHERE rf.referred_user_id = u.id) AS referred_by,
            EXISTS (SELECT 1 FROM referrals WHERE referred_user_id = u.id) AS is_referred
       FROM users u
      WHERE u.id = $1`,
    [userId, today],
  );
  const row = rows[0];
  if (!row) throw new AppError('USER_NOT_FOUND', 'That account does not exist', 404);

  const welcomeClaimed = row.welcome_claimed;
  const welcomeAvailable =
    !welcomeClaimed && config.signup > 0 && !(await welcomeTakenOnDevice(userId));

  return {
    welcome: { coins: config.signup, claimed: welcomeClaimed, available: welcomeAvailable },
    checkin: {
      ladder: config.checkinLadder,
      claimedToday: row.today_streak !== null,
      streakDay: row.today_streak ?? (await nextStreakDay(userId, today)),
    },
    watch: { ...config.watch, earnedToday: Number(row.watch_today) },
    referral: {
      code: String(row.public_id),
      coins: config.referral.coins,
      minPurchasePaise: config.referral.minPurchasePaise,
      invited: Number(row.invited),
      rewarded: Number(row.rewarded),
      canEnterCode:
        !row.is_referred && Number(row.account_age_days) <= config.referral.attachWindowDays,
      referredBy: row.referred_by,
    },
  };
}
