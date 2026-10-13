// PK battles: settling, matching and expiring.
//
// Two jobs rather than one, because they want very different intervals. A
// battle's result has to land within a second or two of the clock reaching
// zero — the app has been counting down in front of the audience — where a
// host waiting for a random opponent will not notice five seconds either way.
//
// Both are cheap no-ops when nothing is happening: each is a single indexed
// query returning no rows.

import { expirePkInvites, matchPkQueue, settleDuePkBattles } from '../../modules/games/index.js';
import type { Job } from '../scheduler.js';

/**
 * Settle every battle whose window has closed.
 *
 * Five seconds. The countdown is on screen in both rooms, and a result that
 * arrives twenty seconds after zero reads as the app having hung at the moment
 * everybody is watching it hardest.
 *
 * It does NOT page on failure: a battle that fails to settle costs a scoreboard
 * and no money, and the next sweep retries it five seconds later.
 */
export const pkSettleJob: Job = {
  name: 'pk_settle',
  everyMs: 5_000,
  run: async () => {
    const { settled } = await settleDuePkBattles();
    return settled > 0 ? { settled } : undefined;
  },
};

/** Pair waiting hosts, and tidy up stale invitations. */
export const pkMatchJob: Job = {
  name: 'pk_match',
  everyMs: 10_000,
  run: async () => {
    const [match, invites] = await Promise.all([matchPkQueue(), expirePkInvites()]);
    return match.matched || match.expired || invites.expired
      ? { matched: match.matched, queueExpired: match.expired, invitesExpired: invites.expired }
      : undefined;
  },
};
