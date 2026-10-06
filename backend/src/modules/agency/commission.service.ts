// Commission: what an agency earns, and when it is decided.
//
// Two rules do most of the work here, and both exist to stop an agency being
// repriced behind its back:
//
//   1. THE RATE IS FIXED BEFORE THE PERIOD STARTS. October's team volume sets
//      the rate for every gift in November. So an agency knows its rate in
//      advance, can tell a sub-agent what they will earn, and no true-up is
//      ever needed — which is what "recalculated monthly, never retroactive"
//      means literally.
//   2. A LEVEL FALLS BY AT MOST ONE STEP A PERIOD. Rates that only ratchet up
//      are not a ladder; a single bad month erasing a year of progress loses
//      the agency.
//
// The split: a sub-agent earns their own hosts at their own rate, and the
// agency earns the DIFFERENTIAL on those hosts plus the full rate on hosts it
// holds directly. Total cost is always `team points × the agency's rate`,
// whatever shape the tree is — the split only decides who receives it.
//
// Nothing here is paid in rupees. Commission is credited as POINTS, which the
// payee withdraws themselves (hard rule #2); the rupee payout is M8.

import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { ECONOMY, getConfigValue, postTransaction, pointsToPaise } from '../economy/index.js';

// ── The level table ─────────────────────────────────────────────────────────

const levelsSchema = z
  .array(
    z.object({
      level: z.string().min(1).max(8),
      minPoints: z.number().int().min(0),
      rateBp: z.number().int().min(0).max(10_000),
    }),
  )
  .min(1);

export type LevelBand = z.infer<typeof levelsSchema>[number];

/** The founder's D/C/B/A/S, used if the config row is missing or malformed. */
const DEFAULT_LEVELS: LevelBand[] = [
  { level: 'D', minPoints: 0, rateBp: 400 },
  { level: 'C', minPoints: 2_000_000, rateBp: 800 },
  { level: 'B', minPoints: 10_000_000, rateBp: 1_200 },
  { level: 'A', minPoints: 50_000_000, rateBp: 1_600 },
  { level: 'S', minPoints: 150_000_000, rateBp: 2_000 },
];

export async function levelBands(): Promise<LevelBand[]> {
  const parsed = levelsSchema.safeParse(await getConfigValue('commission_levels'));
  if (!parsed.success) {
    logger.error('app_config.commission_levels is invalid; using defaults', {
      issues: parsed.error.issues.length,
    });
    return DEFAULT_LEVELS;
  }
  return [...parsed.data].sort((a, b) => a.minPoints - b.minPoints);
}

/** The band a volume falls in. Bands are POINTS, never rupees (§ level table). */
export function bandFor(points: number, bands: LevelBand[]): LevelBand {
  let found = bands[0];
  for (const band of bands) if (points >= band.minPoints) found = band;
  return found;
}

// ── Periods ─────────────────────────────────────────────────────────────────

/** 'YYYY-MM' in IST. India's month does not end at 18:30 the day before. */
export function istMonth(at: Date = new Date()): string {
  return new Date(at.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 7);
}

export function previousMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The half-open IST range a period covers, as UTC instants. */
function periodRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1) - 5.5 * 3_600_000;
  const end = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - 5.5 * 3_600_000;
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

async function ensurePeriod(c: PoolClient, period: string): Promise<void> {
  await c.query('INSERT INTO commission_periods (period) VALUES ($1) ON CONFLICT DO NOTHING', [
    period,
  ]);
}

// ── Levels for a period ─────────────────────────────────────────────────────

interface LevelRow {
  payeeType: 'agency' | 'agent';
  payeeId: string;
  level: string;
  rateBp: number;
  measuredPoints: number;
  cushioned: boolean;
}

/**
 * Volume per payee in a period, straight from the attributions.
 *
 * An agency counts its whole team; an agent counts only their own hosts.
 */
async function volumes(
  c: PoolClient,
  period: string,
): Promise<{ agencies: Map<string, number>; agents: Map<string, number> }> {
  const { rows } = await c.query<{ kind: string; id: string; points: string }>(
    `SELECT 'agency' AS kind, agency_id AS id, SUM(points) AS points
       FROM commission_attributions WHERE period = $1 GROUP BY agency_id
      UNION ALL
     SELECT 'agent', agent_id, SUM(points)
       FROM commission_attributions WHERE period = $1 GROUP BY agent_id`,
    [period],
  );
  const agencies = new Map<string, number>();
  const agents = new Map<string, number>();
  for (const r of rows) {
    (r.kind === 'agency' ? agencies : agents).set(r.id, Number(r.points));
  }
  return { agencies, agents };
}

/**
 * Fix every payee's rate for `period`, from the PREVIOUS period's volume.
 *
 * Idempotent: a level already written is left alone, because it may already
 * have been shown to the agency and quoted to their sub-agents.
 */
export async function openPeriod(period: string): Promise<LevelRow[]> {
  const bands = await levelBands();
  const previous = previousMonth(period);

  return withTransaction(async (c) => {
    await ensurePeriod(c, period);
    await ensurePeriod(c, previous);

    const { agencies, agents } = await volumes(c, previous);
    const { rows: priorLevels } = await c.query<{
      payee_type: string;
      payee_id: string;
      level: string;
    }>('SELECT payee_type, payee_id, level FROM commission_levels WHERE period = $1', [previous]);
    const prior = new Map(priorLevels.map((r) => [`${r.payee_type}:${r.payee_id}`, r.level]));

    const order = bands.map((b) => b.level);
    /** A level may fall by at most one step — § "A level may fall, but by at most one". */
    function cushion(payeeKey: string, earned: LevelBand): { band: LevelBand; cushioned: boolean } {
      const last = prior.get(payeeKey);
      if (last === undefined) return { band: earned, cushioned: false };
      const lastIndex = order.indexOf(last);
      const earnedIndex = order.indexOf(earned.level);
      if (lastIndex < 0 || earnedIndex >= lastIndex - 1) return { band: earned, cushioned: false };
      return { band: bands[lastIndex - 1], cushioned: true };
    }

    // Agencies first: a sub-agent's rate is capped at their agency's, so the
    // agency's number has to exist before the agent's can be settled.
    const { rows: liveAgencies } = await c.query<{ id: string }>(
      "SELECT id FROM agencies WHERE status <> 'closed' AND NOT is_house",
    );
    const written: LevelRow[] = [];
    const agencyRate = new Map<string, number>();

    for (const agency of liveAgencies) {
      const measured = agencies.get(agency.id) ?? 0;
      // A new agency has no previous period to be measured on, so it starts at
      // the bottom band rather than at nothing.
      const { band, cushioned } = cushion(`agency:${agency.id}`, bandFor(measured, bands));
      agencyRate.set(agency.id, band.rateBp);
      written.push({
        payeeType: 'agency',
        payeeId: agency.id,
        level: band.level,
        rateBp: band.rateBp,
        measuredPoints: measured,
        cushioned,
      });
    }

    const { rows: liveAgents } = await c.query<{ id: string; agency_id: string }>(
      `SELECT a.id, aa.agency_id
         FROM agents a
         JOIN agent_agency_assignments aa ON aa.agent_id = a.id AND aa.effective_to IS NULL
         JOIN agencies g ON g.id = aa.agency_id
        WHERE a.status = 'active' AND g.status <> 'closed' AND NOT g.is_house
          AND a.id <> g.owner_agent_id`,
    );
    for (const agent of liveAgents) {
      const measured = agents.get(agent.id) ?? 0;
      const { band, cushioned } = cushion(`agent:${agent.id}`, bandFor(measured, bands));
      // The cap matters in the one case the arithmetic does not handle itself:
      // the agency slipped a step while the sub-agent climbed one. Without it
      // the agency's differential goes negative and it would owe money on its
      // own team's work.
      const capped = Math.min(band.rateBp, agencyRate.get(agent.agency_id) ?? band.rateBp);
      written.push({
        payeeType: 'agent',
        payeeId: agent.id,
        level: band.level,
        rateBp: capped,
        measuredPoints: measured,
        cushioned,
      });
    }

    for (const row of written) {
      await c.query(
        `INSERT INTO commission_levels
           (period, payee_type, payee_id, level, rate_bp, measured_points, cushioned)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (period, payee_type, payee_id) DO NOTHING`,
        [
          period,
          row.payeeType,
          row.payeeId,
          row.level,
          row.rateBp,
          row.measuredPoints,
          row.cushioned,
        ],
      );
    }
    return written;
  });
}

// ── Closing a period ────────────────────────────────────────────────────────

/**
 * Derive the attributions for a period: which gift earned what, under whom.
 *
 * The two dated lookups the whole design rests on — gift timestamp → the host's
 * agent THEN → that agent's agency THEN. A host who moved on the 14th has the
 * first half of the month land under one agent and the second under another,
 * with no row rewritten anywhere.
 *
 * Reversed gifts never become attributions at all, which is the open-period
 * half of the reversal rule.
 */
async function deriveAttributions(c: PoolClient, period: string): Promise<number> {
  const { from, to } = periodRange(period);
  const { rowCount } = await c.query(
    `INSERT INTO commission_attributions
       (gift_txn_id, period, host_user_id, agent_id, agency_id, points, gift_at)
     SELECT gs.txn_id, $1, gs.recipient_user_id, h.agent_id, aa.agency_id, gs.points, gs.created_at
       FROM gift_sends gs
       JOIN ledger_txns t ON t.id = gs.txn_id AND t.status = 'completed'
       JOIN host_agent_assignments h
         ON h.host_user_id = gs.recipient_user_id
        AND gs.created_at >= h.effective_from
        AND (h.effective_to IS NULL OR gs.created_at < h.effective_to)
       JOIN agent_agency_assignments aa
         ON aa.agent_id = h.agent_id
        AND gs.created_at >= aa.effective_from
        AND (aa.effective_to IS NULL OR gs.created_at < aa.effective_to)
       JOIN agencies g ON g.id = aa.agency_id AND NOT g.is_house
      WHERE gs.created_at >= $2 AND gs.created_at < $3
        AND gs.points > 0
        -- A gift reversed before the period closed was never really earned.
        AND NOT EXISTS (SELECT 1 FROM ledger_txns r WHERE r.reverses_txn_id = gs.txn_id)
     ON CONFLICT (gift_txn_id) DO NOTHING`,
    [period, from, to],
  );
  return rowCount ?? 0;
}

export interface CloseResult {
  period: string;
  attributions: number;
  giftPoints: number;
  accruals: Array<{
    payeeType: 'agency' | 'agent';
    payeeId: string;
    basePoints: number;
    rateBp: number;
    points: number;
  }>;
  alreadyClosed: boolean;
}

/**
 * Close a period: derive, resolve, post, lock.
 *
 * One transaction per payee, as the doc requires — not one per gift. The close
 * is idempotent twice over: a closed period returns without doing anything, and
 * each accrual's ledger key is derived from the period and the payee, so a
 * crash halfway through resumes rather than double-paying.
 */
export async function closePeriod(period: string, actorUserId?: string): Promise<CloseResult> {
  const { rows: existing } = await pool.query<{ status: string }>(
    'SELECT status FROM commission_periods WHERE period = $1',
    [period],
  );
  if (existing[0]?.status === 'closed') {
    return { period, attributions: 0, giftPoints: 0, accruals: [], alreadyClosed: true };
  }
  if (period >= istMonth()) {
    throw new AppError('PERIOD_NOT_OVER', 'That period has not finished yet', 409);
  }

  // Levels for the period being closed must exist before anything is priced.
  // Normally written when the period opened; computed now if that never ran.
  await openPeriod(period);

  const { attributions, totals } = await withTransaction(async (c) => {
    await ensurePeriod(c, period);
    const count = await deriveAttributions(c, period);

    const { rows } = await c.query<{
      agency_id: string;
      agent_id: string;
      is_owner_seat: boolean;
      points: string;
    }>(
      `SELECT a.agency_id, a.agent_id, (a.agent_id = g.owner_agent_id) AS is_owner_seat,
              SUM(a.points) AS points
         FROM commission_attributions a
         JOIN agencies g ON g.id = a.agency_id
        WHERE a.period = $1
        GROUP BY a.agency_id, a.agent_id, g.owner_agent_id`,
      [period],
    );
    return { attributions: count, totals: rows };
  });

  const { rows: levelRows } = await pool.query<{
    payee_type: string;
    payee_id: string;
    rate_bp: number;
  }>('SELECT payee_type, payee_id, rate_bp FROM commission_levels WHERE period = $1', [period]);
  const rate = new Map(levelRows.map((r) => [`${r.payee_type}:${r.payee_id}`, r.rate_bp]));

  // Build the split before posting anything, so a payee gets exactly one
  // transaction however many agents or seats contributed to their total.
  const agencyOwed = new Map<string, { base: number; points: number }>();
  const agentOwed = new Map<string, { base: number; points: number; rateBp: number }>();
  let giftPoints = 0;

  for (const row of totals) {
    const points = Number(row.points);
    giftPoints += points;
    const agencyRate = rate.get(`agency:${row.agency_id}`) ?? 0;

    if (row.is_owner_seat) {
      // Held directly by the owner: the agency takes the whole rate, and the
      // owner's own seat earns nothing separately — it would be paying twice
      // for the same work.
      const owed = agencyOwed.get(row.agency_id) ?? { base: 0, points: 0 };
      owed.base += points;
      owed.points += Math.floor((points * agencyRate) / 10_000);
      agencyOwed.set(row.agency_id, owed);
      continue;
    }

    const agentRate = Math.min(rate.get(`agent:${row.agent_id}`) ?? 0, agencyRate);
    const agent = agentOwed.get(row.agent_id) ?? { base: 0, points: 0, rateBp: agentRate };
    agent.base += points;
    agent.points += Math.floor((points * agentRate) / 10_000);
    agentOwed.set(row.agent_id, agent);

    // The agency keeps the gap. Together the two always add up to the agency's
    // full rate on the whole team.
    const owed = agencyOwed.get(row.agency_id) ?? { base: 0, points: 0 };
    owed.base += points;
    owed.points +=
      Math.floor((points * agencyRate) / 10_000) - Math.floor((points * agentRate) / 10_000);
    agencyOwed.set(row.agency_id, owed);
  }

  const accruals: CloseResult['accruals'] = [];
  for (const [agencyId, owed] of agencyOwed) {
    if (owed.points <= 0) continue;
    await postAccrual(
      period,
      'agency',
      agencyId,
      owed.base,
      rate.get(`agency:${agencyId}`) ?? 0,
      owed.points,
      actorUserId,
    );
    accruals.push({
      payeeType: 'agency',
      payeeId: agencyId,
      basePoints: owed.base,
      rateBp: rate.get(`agency:${agencyId}`) ?? 0,
      points: owed.points,
    });
  }
  for (const [agentId, owed] of agentOwed) {
    if (owed.points <= 0) continue;
    await postAccrual(period, 'agent', agentId, owed.base, owed.rateBp, owed.points, actorUserId);
    accruals.push({
      payeeType: 'agent',
      payeeId: agentId,
      basePoints: owed.base,
      rateBp: owed.rateBp,
      points: owed.points,
    });
  }

  await pool.query(
    `UPDATE commission_periods
        SET status = 'closed', closed_at = now(), closed_by = $2,
            gift_points = $3, payee_count = $4
      WHERE period = $1 AND status = 'open'`,
    [period, actorUserId ?? null, giftPoints, accruals.length],
  );

  // The next period's rates are now knowable, so fix them immediately.
  await openPeriod(nextMonth(period));

  return { period, attributions, giftPoints, accruals, alreadyClosed: false };
}

function nextMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * One payee, one period, one transaction.
 *
 * Points land in `_held`, like a host's: a chargeback can still arrive after a
 * period closes, and the hold is the window that exists for exactly that. The
 * release to withdrawable is M8's, and it covers all three account types.
 */
async function postAccrual(
  period: string,
  payeeType: 'agency' | 'agent',
  payeeId: string,
  basePoints: number,
  rateBp: number,
  points: number,
  actorUserId?: string,
): Promise<void> {
  const account = payeeType === 'agency' ? 'agency_points_held' : 'agent_points_held';
  const paise = pointsToPaise(points);

  await postTransaction({
    txnType: 'agency_commission_accrual',
    // Derived from the period and the payee, never a client header: the close
    // IS the money event, so a resumed close credits once.
    idempotencyKey: `commission:${period}:${payeeType}:${payeeId}`,
    identity: { period, payee_type: payeeType, payee_id: payeeId, points },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
    },
    legs: [
      { accountCode: 'system_point_float', unit: 'point', amount: -points },
      { accountCode: account, scopeId: payeeId, unit: 'point', amount: points },
      ...(paise > 0
        ? [
            { accountCode: 'expense_agency_commission', unit: 'paise' as const, amount: paise },
            { accountCode: 'points_payable', unit: 'paise' as const, amount: -paise },
          ]
        : []),
    ],
    actorUserId,
    memo: `commission ${period} ${payeeType}`,
    withinTransaction: async (client, txnId) => {
      await client.query(
        `INSERT INTO commission_accruals
           (id, period, payee_type, payee_id, base_points, rate_bp, points, ledger_txn_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (period, payee_type, payee_id) DO NOTHING`,
        [uuidv7(), period, payeeType, payeeId, basePoints, rateBp, points, txnId],
      );
    },
    events: [
      {
        eventType: 'commission_accrued',
        partitionKey: payeeId,
        payload: { period, payee_type: payeeType, payee_id: payeeId, points, rate_bp: rateBp },
      },
    ],
  });
}

// ── What a payee sees ───────────────────────────────────────────────────────

export interface CommissionSummary {
  payeeType: 'agency' | 'agent';
  /** This period's rate — fixed before it began, so it is a real number to show. */
  current: { period: string; level: string; rateBp: number; measuredPoints: number } | null;
  /** Team points so far this period: what sets NEXT period's rate. */
  earningNow: number;
  /** The level that volume would currently earn. */
  projected: { level: string; rateBp: number } | null;
  /**
   * Every band, so the app can DRAW the ladder rather than describe it.
   *
   * Server-driven like every other dial: retuning `commission_levels` must
   * change what an agency sees without an app release.
   */
  ladder: Array<{ level: string; minPoints: number; rateBp: number }>;
  /** The rung above the projected one, and the gap to it. Null at the top. */
  nextLevel: { level: string; rateBp: number; pointsNeeded: number } | null;
  history: Array<{ period: string; points: number; basePoints: number; rateBp: number }>;
}

export async function commissionSummary(
  payeeType: 'agency' | 'agent',
  payeeId: string,
): Promise<CommissionSummary> {
  const period = istMonth();
  const bands = await levelBands();
  const column = payeeType === 'agency' ? 'agency_id' : 'agent_id';

  const [level, live, history] = await Promise.all([
    pool.query(
      `SELECT period, level, rate_bp, measured_points FROM commission_levels
        WHERE period = $1 AND payee_type = $2 AND payee_id = $3`,
      [period, payeeType, payeeId],
    ),
    // Not yet attributed — the period is still open — so counted from the
    // gifts directly, through the same two dated links the close will use.
    pool.query<{ points: string }>(
      `SELECT COALESCE(SUM(gs.points), 0) AS points
         FROM gift_sends gs
         JOIN ledger_txns t ON t.id = gs.txn_id AND t.status = 'completed'
         JOIN host_agent_assignments h
           ON h.host_user_id = gs.recipient_user_id
          AND gs.created_at >= h.effective_from
          AND (h.effective_to IS NULL OR gs.created_at < h.effective_to)
         JOIN agent_agency_assignments aa
           ON aa.agent_id = h.agent_id
          AND gs.created_at >= aa.effective_from
          AND (aa.effective_to IS NULL OR gs.created_at < aa.effective_to)
        WHERE gs.created_at >= $2 AND gs.created_at < $3 AND aa.${column} = $1`,
      [payeeId, periodRange(period).from, periodRange(period).to],
    ),
    pool.query(
      `SELECT period, points, base_points, rate_bp FROM commission_accruals
        WHERE payee_type = $1 AND payee_id = $2
        ORDER BY period DESC LIMIT 12`,
      [payeeType, payeeId],
    ),
  ]);

  const earningNow = Number(live.rows[0].points);
  const band = bandFor(earningNow, bands);

  // The arithmetic for "how far to the next rung" stays on the server, so the
  // app never computes a level — the same rule the user level already follows.
  const above = bands.find((b) => b.minPoints > earningNow) ?? null;

  return {
    payeeType,
    current: level.rows[0]
      ? {
          period: level.rows[0].period,
          level: level.rows[0].level,
          rateBp: level.rows[0].rate_bp,
          measuredPoints: Number(level.rows[0].measured_points),
        }
      : null,
    earningNow,
    projected: { level: band.level, rateBp: band.rateBp },
    ladder: bands.map((b) => ({ level: b.level, minPoints: b.minPoints, rateBp: b.rateBp })),
    nextLevel: above
      ? {
          level: above.level,
          rateBp: above.rateBp,
          pointsNeeded: above.minPoints - earningNow,
        }
      : null,
    history: history.rows.map((r) => ({
      period: r.period,
      points: Number(r.points),
      basePoints: Number(r.base_points),
      rateBp: r.rate_bp,
    })),
  };
}
