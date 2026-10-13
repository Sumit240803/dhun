// The hourly room board.
//
// A rollup rather than a live query: ranking on read would sort every gift in
// the last hour once per viewer per refresh, in the busiest room on the
// platform. Migration 029's header has the long version.

import { purgeOldHours, rollupRoomHour } from '../../modules/rooms/index.js';
import type { Job } from '../scheduler.js';

/**
 * Recompute where every room stands this hour.
 *
 * Sixty seconds, matching `room_board.refreshSeconds` — the app polls at the
 * same rate, and anything faster reads a number that has not changed.
 *
 * Does not page on failure. A stale rank costs a progress bar; nothing here is
 * money, and the next run is a minute away.
 */
export const roomHourRollupJob: Job = {
  name: 'room_hour_rollup',
  everyMs: 60_000,
  run: async () => {
    const { rooms } = await rollupRoomHour();
    return rooms > 0 ? { rooms } : undefined;
  },
};

/** Drop finished hours. Daily, off-peak, with everything else that purges. */
export const purgeRoomHourScoresJob: Job = {
  name: 'purge_room_hour_scores',
  dailyAtIst: '04:10',
  run: async () => {
    const deleted = await purgeOldHours();
    return deleted > 0 ? { deleted } : undefined;
  },
};
