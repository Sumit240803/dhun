// The analytics sink (migration 039) and the numbers read from it.
//
// Writes are client events — what only the app can see. Every money number is
// read from purchases, gift_sends and room_sessions instead, which the ledger
// wrote; see the migration's header for why.

import { uuidv7 } from 'uuidv7';
import { pool } from '../../infra/db.js';
import { sanitiseMeta } from '../../infra/eventLog.js';

export interface AnalyticsEventInput {
  event: string;
  occurredAt?: string;
  sessionId?: string;
  props?: Record<string, string | number | boolean | null>;
}

export interface AnalyticsBatch {
  /** From the access token, never from the body. Null for a guest before sign-in. */
  userId: string | null;
  deviceId: string | null;
  app: { version: string; platform: 'android' | 'ios' | 'web'; update?: string };
  events: AnalyticsEventInput[];
}

const MAX_PROP_KEYS = 30;

/**
 * A client's clock is accepted only if it is recent and not in the future;
 * otherwise the server's receipt time stands. Seven days back covers a phone
 * that was offline for a week; partitions exist that far (migration 039).
 */
export function plausibleTime(iso: string | undefined, now = Date.now()): Date {
  if (!iso) return new Date(now);
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at) || at > now + 60_000 || at < now - 7 * 24 * 3_600_000) return new Date(now);
  return new Date(at);
}

/** Primitives only, secrets redacted by key name, a bounded number of keys. */
function cleanProps(props: AnalyticsEventInput['props']): Record<string, unknown> {
  const safe = sanitiseMeta(props ?? {});
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(safe).slice(0, MAX_PROP_KEYS)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
  }
  return out;
}

/** One INSERT for the whole batch. */
export async function recordAnalytics(batch: AnalyticsBatch): Promise<number> {
  if (batch.events.length === 0) return 0;
  const now = Date.now();
  const values: unknown[] = [];
  const tuples = batch.events.map((e, i) => {
    const b = i * 10;
    values.push(
      uuidv7(),
      plausibleTime(e.occurredAt, now),
      e.event,
      batch.userId,
      batch.deviceId,
      e.sessionId ?? null,
      batch.app.version,
      batch.app.platform,
      batch.app.update ?? null,
      JSON.stringify(cleanProps(e.props)),
    );
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}::jsonb)`;
  });
  await pool.query(
    `INSERT INTO analytics_events
       (id, occurred_at, event, user_id, device_id, session_id, app_version, platform, app_update, props)
     VALUES ${tuples.join(', ')}`,
    values,
  );
  return batch.events.length;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface DayActive {
  day: string;
  devices: number;
  signedIn: number;
}

export interface FunnelStep {
  step: number;
  name: string;
  people: number;
}

export interface DayMoney {
  day: string;
  payers: number;
  grossPaise: number;
  activeAccounts: number;
  payerRateBp: number | null;
  gifts: number;
  giftCoins: number;
  roomHours: number;
  coinsPerRoomHour: number | null;
}

export interface Cohort {
  cohort: string;
  devices: number;
  d1: number;
  d7: number;
}

const days = (n: number) => Math.min(Math.max(Math.trunc(n), 1), 90);

export async function dailyActive(n = 14): Promise<DayActive[]> {
  const { rows } = await pool.query<{ day: string; devices: string; signed_in: string }>(
    `SELECT day::text AS day, devices, signed_in FROM analytics_daily_active
      WHERE day > (now() AT TIME ZONE 'Asia/Kolkata')::date - $1::int ORDER BY day DESC`,
    [days(n)],
  );
  return rows.map((r) => ({ day: r.day, devices: Number(r.devices), signedIn: Number(r.signed_in) }));
}

/** Defaults to yesterday, the last complete IST day. */
export async function funnel(day?: string): Promise<{ day: string; steps: FunnelStep[] }> {
  const { rows } = await pool.query<{ day: string; step: number; name: string; people: string }>(
    `SELECT d::text AS day, f.step, f.name, f.people
       FROM (SELECT coalesce($1::date, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1) AS d) x,
            LATERAL analytics_funnel(x.d) f`,
    [day ?? null],
  );
  return {
    day: rows[0]?.day ?? '',
    steps: rows.map((r) => ({ step: r.step, name: r.name, people: Number(r.people) })),
  };
}

export async function dailyMoney(n = 14): Promise<DayMoney[]> {
  const { rows } = await pool.query(
    `SELECT day::text AS day, payers, gross_paise, active_accounts, payer_rate_bp,
            gifts, gift_coins, room_hours, coins_per_room_hour
       FROM analytics_daily_money
      WHERE day > (now() AT TIME ZONE 'Asia/Kolkata')::date - $1::int
      ORDER BY day DESC`,
    [days(n)],
  );
  const num = (v: unknown) => (v === null ? null : Number(v));
  return rows.map((r) => ({
    day: r.day,
    payers: Number(r.payers),
    grossPaise: Number(r.gross_paise),
    activeAccounts: Number(r.active_accounts),
    payerRateBp: num(r.payer_rate_bp),
    gifts: Number(r.gifts),
    giftCoins: Number(r.gift_coins),
    roomHours: Number(r.room_hours),
    coinsPerRoomHour: num(r.coins_per_room_hour),
  }));
}

export async function retention(n = 14): Promise<Cohort[]> {
  const { rows } = await pool.query<{ cohort: string; devices: string; d1: string; d7: string }>(
    `SELECT cohort::text AS cohort, devices, d1, d7 FROM analytics_retention
      WHERE cohort > (now() AT TIME ZONE 'Asia/Kolkata')::date - $1::int ORDER BY cohort DESC`,
    [days(n)],
  );
  return rows.map((r) => ({ cohort: r.cohort, devices: Number(r.devices), d1: Number(r.d1), d7: Number(r.d7) }));
}
