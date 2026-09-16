// PUBLIC API of the rewards module.
//
// Free coins — the welcome bonus, the daily check-in streak, the watch reward
// and referrals. Coins move only through economy's ledger; this module decides
// who has earned what and makes sure nobody earns it twice.

export { buildRewardsRouter } from './rewards.routes.js';

export {
  attachReferral,
  claimCheckin,
  claimWelcome,
  freeCoinsConfig,
  grantWatchReward,
  istDate,
  rewardReferral,
  rewardsStatus,
} from './rewards.service.js';
export type { FreeCoinsConfig, RewardsStatus } from './rewards.service.js';
