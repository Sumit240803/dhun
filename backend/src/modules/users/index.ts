// PUBLIC API of the users module: profile reads that are not authentication.
//
// auth owns the identity row and the session; this owns what a profile SHOWS.

export { buildUsersRouter } from './users.routes.js';
export { getProfileSummary } from './summary.service.js';
export type { ProfileSummary } from './summary.service.js';
