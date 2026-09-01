// PUBLIC API of the users module: profiles, the social graph, and visitors.
//
// auth owns the identity row and the session; this owns what a profile SHOWS
// and who is connected to whom.

export { buildUsersRouter } from './users.routes.js';
export { getProfileSummary } from './summary.service.js';
export type { ProfileSummary } from './summary.service.js';

export {
  followUser,
  unfollowUser,
  isFollowing,
  recordVisit,
  listVisitors,
  markVisitorsSeen,
} from './follows.service.js';
export type { Visitor } from './follows.service.js';
