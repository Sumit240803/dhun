// Closing commission periods.
//
// Runs daily rather than monthly, and closes whatever is finished and still
// open. A monthly cron that misses its one firing — a deploy, a restart, an
// outage on the 1st — would leave an entire month unpaid and nobody would
// notice until an agency asked. Daily and idempotent means a missed day costs
// nothing: the next run closes it.
//
// Deliberately NOT at 03:00 with reconciliation. The close posts money; the
// reconciliation checks money. Running them together would mean the night's
// checks see a half-written period and page about it.

import { closePeriod, istMonth, openPeriod, previousMonth } from '../../modules/agency/index.js';
import { pool } from '../../infra/db.js';
import type { Job } from '../scheduler.js';

export const commissionCloseJob: Job = {
  name: 'commission_period_close',
  dailyAtIst: '05:00',
  // An unpaid period is a bill the platform owes and has not written down.
  pageOnFailure: true,
  run: async () => {
    const current = istMonth();

    // Any period that has ended and is still open. Normally exactly one, on the
    // 1st; more than one only after an outage, which is the case this exists for.
    const { rows } = await pool.query<{ period: string }>(
      "SELECT period FROM commission_periods WHERE status = 'open' AND period < $1 ORDER BY period",
      [current],
    );

    // The very first run has no period rows at all: nothing has ever opened one.
    // Seed last month so the first close has something to work on.
    if (rows.length === 0) {
      await openPeriod(previousMonth(current));
      await openPeriod(current);
      const { rows: seeded } = await pool.query<{ period: string }>(
        "SELECT period FROM commission_periods WHERE status = 'open' AND period < $1 ORDER BY period",
        [current],
      );
      rows.push(...seeded);
    }

    let closed = 0;
    let points = 0;
    let payees = 0;
    for (const row of rows) {
      const result = await closePeriod(row.period);
      if (result.alreadyClosed) continue;
      closed++;
      points += result.giftPoints;
      payees += result.accruals.length;
    }

    return closed ? { periodsClosed: closed, giftPoints: points, payees } : undefined;
  },
};
