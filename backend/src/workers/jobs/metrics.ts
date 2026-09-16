// Daily business numbers the ledger already knows, written down once a day.
//
// M7's exit criterion is that the cosmetics share of spend is MEASURABLE. The
// ledger measures it by construction — gifts credit `revenue_gifting`,
// cosmetics credit `revenue_cosmetics` — so this job does not compute anything
// new. It reads the two accounts for yesterday and records the split in
// `job_runs.result`, so the number the economy is tuned on is one query away:
//
//   SELECT started_at, result FROM job_runs
//    WHERE job = 'spend_mix' AND status = 'succeeded' ORDER BY id DESC;
//
// The design target (economy-design-v1) is roughly 75–80% gifting to 20–25%
// cosmetics. Too little cosmetics share means gems are piling up unspent and
// the blended payout ratio is higher than the model assumes.

import { pool } from '../../infra/db.js';
import type { Job } from '../scheduler.js';

export interface SpendMix {
  /** The IST calendar day measured, YYYY-MM-DD. */
  day: string;
  giftingPaise: number;
  cosmeticsPaise: number;
  /** Cosmetics as a share of the two, in basis points. Null on a day with neither. */
  cosmeticsShareBp: number | null;
}

/**
 * Revenue recognised from gifts and from cosmetics on one IST day.
 *
 * Revenue accounts carry credits as negative amounts, so the sums are negated.
 * Reversals are included on purpose — a refunded cosmetic was not revenue.
 */
export async function spendMix(day: string): Promise<SpendMix> {
  const { rows } = await pool.query<{ gifting: string | null; cosmetics: string | null }>(
    `SELECT -SUM(e.amount) FILTER (WHERE a.code = 'revenue_gifting')   AS gifting,
            -SUM(e.amount) FILTER (WHERE a.code = 'revenue_cosmetics') AS cosmetics
       FROM ledger_entries e
       JOIN ledger_accounts a ON a.id = e.account_id
      WHERE a.code IN ('revenue_gifting', 'revenue_cosmetics')
        AND e.created_at >= ($1::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
        AND e.created_at <  ($1::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'`,
    [day],
  );

  const giftingPaise = Number(rows[0]?.gifting ?? 0);
  const cosmeticsPaise = Number(rows[0]?.cosmetics ?? 0);
  const total = giftingPaise + cosmeticsPaise;

  return {
    day,
    giftingPaise,
    cosmeticsPaise,
    cosmeticsShareBp: total > 0 ? Math.round((cosmeticsPaise * 10_000) / total) : null,
  };
}

/** Yesterday, as an IST calendar date. */
function yesterdayIst(): string {
  const ist = new Date(Date.now() + 5.5 * 3_600_000 - 86_400_000);
  return ist.toISOString().slice(0, 10);
}

export const spendMixJob: Job = {
  name: 'spend_mix',
  // After reconciliation (03:00), so a day is only measured once it has been
  // proven to balance.
  dailyAtIst: '03:30',
  run: async () => ({ ...(await spendMix(yesterdayIst())) }),
};
