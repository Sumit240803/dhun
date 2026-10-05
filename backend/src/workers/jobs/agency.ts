// Agency membership sweeps.
//
// Rule 1 of quitting: an application the owner never answers lets the host go
// after the window. The host's screen already shows the date; this is what
// makes it true.

import { autoLeaveOverdue, expireJoinRequests } from '../../modules/agency/index.js';
import type { Job } from '../scheduler.js';

export const agencyMembershipSweepJob: Job = {
  name: 'agency_membership_sweep',
  everyMs: 15 * 60_000,
  run: async () => {
    const [left, expired] = await Promise.all([autoLeaveOverdue(), expireJoinRequests()]);
    return left || expired ? { autoLeft: left, requestsExpired: expired } : undefined;
  },
};
