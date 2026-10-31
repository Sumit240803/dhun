// Spend controls — the brakes a user puts on themselves.
//
// trust-and-safety-v1 § financial harm: a self-set daily and monthly limit,
// self-exclusion for 30 or 90 days or for good, and a cooling-off prompt past
// ₹50,000 a month. Measured on coins spent on GIFTS, where money leaves a
// user for good; buying coins is its own decision at the store.
//
// Three rules keep these honest (migration 036):
//   · a cap lowers at once and raises only after a delay;
//   · an exclusion cannot be shortened or lifted while it runs;
//   · the check happens on the server, in sendGift, not in the app.

import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { getConfigNumber, getConfigValue } from '../economy/index.js';

export type Exclusion = 'none' | '30d' | '90d' | 'permanent';

export interface PendingRaise {
  /** Present only for a cap being raised; null means "no cap". */
  dailyCapCoins?: number | null;
  monthlyCapCoins?: number | null;
  appliesAt: string;
}

export interface SpendControls {
  dailyCapCoins: number | null;
  monthlyCapCoins: number | null;
  pending: PendingRaise | null;
  excludedUntil: string | null;
  excludedPermanently: boolean;
}

export interface SpendStatus extends SpendControls {
  todayCoins: number;
  monthCoins: number;
  /** Past the cooling-off line this month. The app shows the prompt once. */
  coolingOff: boolean;
  coolingOffAtCoins: number;
  excluded: boolean;
}

interface Row {
  daily_cap_coins: string | null;
  monthly_cap_coins: string | null;
  pending: PendingRaise | null;
  excluded_until: Date | null;
  excluded_permanently: boolean;
}

const num = (v: string | null) => (v === null ? null : Number(v));
const INF = Number.POSITIVE_INFINITY;

/** Applies a pending raise whose time has come, then returns the row. */
async function loadControls(userId: string): Promise<Row | null> {
  await pool.query(
    `UPDATE spend_controls
        SET daily_cap_coins = CASE WHEN pending ? 'dailyCapCoins'
                                   THEN (pending ->> 'dailyCapCoins')::bigint ELSE daily_cap_coins END,
            monthly_cap_coins = CASE WHEN pending ? 'monthlyCapCoins'
                                     THEN (pending ->> 'monthlyCapCoins')::bigint ELSE monthly_cap_coins END,
            pending = NULL
      WHERE user_id = $1
        AND pending IS NOT NULL
        AND (pending ->> 'appliesAt')::timestamptz <= now()`,
    [userId],
  );
  const { rows } = await pool.query<Row>('SELECT * FROM spend_controls WHERE user_id = $1', [userId]);
  return rows[0] ?? null;
}

function toControls(row: Row | null): SpendControls {
  if (!row) {
    return {
      dailyCapCoins: null,
      monthlyCapCoins: null,
      pending: null,
      excludedUntil: null,
      excludedPermanently: false,
    };
  }
  return {
    dailyCapCoins: num(row.daily_cap_coins),
    monthlyCapCoins: num(row.monthly_cap_coins),
    pending: row.pending,
    excludedUntil: row.excluded_until?.toISOString() ?? null,
    excludedPermanently: row.excluded_permanently,
  };
}

async function spentOnGifts(userId: string): Promise<{ today: number; month: number }> {
  const { rows } = await pool.query<{ today: string; month: string }>(
    `SELECT COALESCE(SUM(coins) FILTER (
              WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date
                  = (now() AT TIME ZONE 'Asia/Kolkata')::date), 0) AS today,
            COALESCE(SUM(coins), 0) AS month
       FROM gift_sends
      WHERE sender_user_id = $1
        AND created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`,
    [userId],
  );
  return { today: Number(rows[0]?.today ?? 0), month: Number(rows[0]?.month ?? 0) };
}

async function safetyConfig(): Promise<{ coolingOffMonthlyPaise: number; capRaiseDelayHours: number }> {
  const raw = (await getConfigValue('safety')) as Partial<{
    coolingOffMonthlyPaise: number;
    capRaiseDelayHours: number;
  }> | null;
  return {
    coolingOffMonthlyPaise: raw?.coolingOffMonthlyPaise ?? 5_000_000,
    capRaiseDelayHours: raw?.capRaiseDelayHours ?? 24,
  };
}

async function coolingOffLineCoins(): Promise<number> {
  const { coolingOffMonthlyPaise } = await safetyConfig();
  // The pack rate is what a rupee buys, so the rupee line becomes a coin line.
  const coinsPerRupee = await getConfigNumber('pack_coins_per_rupee', 110);
  return Math.round((coolingOffMonthlyPaise / 100) * coinsPerRupee);
}

function isExcluded(row: Row | null): boolean {
  if (!row) return false;
  return row.excluded_permanently || (row.excluded_until !== null && row.excluded_until.getTime() > Date.now());
}

export async function spendStatus(userId: string): Promise<SpendStatus> {
  const [row, spent, line] = await Promise.all([
    loadControls(userId),
    spentOnGifts(userId),
    coolingOffLineCoins(),
  ]);
  return {
    ...toControls(row),
    todayCoins: spent.today,
    monthCoins: spent.month,
    coolingOff: spent.month >= line,
    coolingOffAtCoins: line,
    excluded: isExcluded(row),
  };
}

/**
 * Refuses a gift the user's own limits do not allow. Called by sendGift
 * before any money moves. Nothing here is a platform rule — every number is
 * one the user set, which is why the messages say "your limit".
 */
export async function assertMaySpend(userId: string, coins: number): Promise<void> {
  const row = await loadControls(userId);
  if (!row) return;

  if (isExcluded(row)) {
    throw new AppError('SELF_EXCLUDED', 'You have paused spending on this account', 403, {
      until: row.excluded_until?.toISOString() ?? null,
      permanent: row.excluded_permanently,
    });
  }
  const daily = num(row.daily_cap_coins);
  const monthly = num(row.monthly_cap_coins);
  if (daily === null && monthly === null) return;

  const spent = await spentOnGifts(userId);
  if (daily !== null && spent.today + coins > daily) {
    throw new AppError('SPEND_LIMIT_REACHED', 'This would pass your daily limit', 403, {
      period: 'day',
      capCoins: daily,
      spentCoins: spent.today,
    });
  }
  if (monthly !== null && spent.month + coins > monthly) {
    throw new AppError('SPEND_LIMIT_REACHED', 'This would pass your monthly limit', 403, {
      period: 'month',
      capCoins: monthly,
      spentCoins: spent.month,
    });
  }
}

export async function setSpendControls(
  userId: string,
  /** `exclusion` omitted means "leave the pause as it is", so caps can change under a running pause. */
  input: { dailyCapCoins: number | null; monthlyCapCoins: number | null; exclusion?: Exclusion },
): Promise<SpendStatus> {
  const current = await loadControls(userId);
  const { capRaiseDelayHours } = await safetyConfig();

  // ── Exclusion: binding while it runs ─────────────────────────────────────
  const activeUntil =
    current?.excluded_until && current.excluded_until.getTime() > Date.now() ? current.excluded_until : null;
  let permanently = current?.excluded_permanently ?? false;
  let excludedUntil: Date | null = activeUntil;

  if (input.exclusion === undefined) {
    // No change asked for; whatever runs keeps running.
  } else if (permanently && input.exclusion !== 'permanent') {
    throw new AppError('EXCLUSION_ACTIVE', 'A permanent pause cannot be lifted from the app', 409);
  } else if (input.exclusion === 'permanent') {
    permanently = true;
  } else if (input.exclusion === '30d' || input.exclusion === '90d') {
    const proposed = new Date(Date.now() + (input.exclusion === '30d' ? 30 : 90) * 86_400_000);
    if (activeUntil && proposed < activeUntil) {
      throw new AppError('EXCLUSION_ACTIVE', 'Your pause cannot be shortened while it runs', 409, {
        until: activeUntil.toISOString(),
      });
    }
    excludedUntil = proposed;
  } else if (activeUntil) {
    throw new AppError('EXCLUSION_ACTIVE', 'Your pause cannot be lifted while it runs', 409, {
      until: activeUntil.toISOString(),
    });
  }

  // ── Caps: lower now, raise later ─────────────────────────────────────────
  const effDaily = current ? num(current.daily_cap_coins) : null;
  const effMonthly = current ? num(current.monthly_cap_coins) : null;
  // No row yet means nothing to protect: the first setting applies at once.
  const raise = (from: number | null, to: number | null) => current !== null && (to ?? INF) > (from ?? INF);
  const raiseDaily = raise(effDaily, input.dailyCapCoins);
  const raiseMonthly = raise(effMonthly, input.monthlyCapCoins);

  let pending: PendingRaise | null = null;
  if (raiseDaily || raiseMonthly) {
    pending = { appliesAt: new Date(Date.now() + capRaiseDelayHours * 3_600_000).toISOString() };
    if (raiseDaily) pending.dailyCapCoins = input.dailyCapCoins;
    if (raiseMonthly) pending.monthlyCapCoins = input.monthlyCapCoins;
  }

  await pool.query(
    `INSERT INTO spend_controls
       (user_id, daily_cap_coins, monthly_cap_coins, pending, excluded_until, excluded_permanently)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       daily_cap_coins = EXCLUDED.daily_cap_coins,
       monthly_cap_coins = EXCLUDED.monthly_cap_coins,
       pending = EXCLUDED.pending,
       excluded_until = EXCLUDED.excluded_until,
       excluded_permanently = EXCLUDED.excluded_permanently`,
    [
      userId,
      raiseDaily ? effDaily : input.dailyCapCoins,
      raiseMonthly ? effMonthly : input.monthlyCapCoins,
      pending ? JSON.stringify(pending) : null,
      excludedUntil,
      permanently,
    ],
  );
  return spendStatus(userId);
}
