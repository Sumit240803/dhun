// PUBLIC API of the moderation module.
//
// INTAKE only: a report is recorded durably and a block takes effect
// immediately. Queue triage, strikes, appeals and the automated classifiers are
// M9 and need the policy in trust-and-safety-v1 turned into rules first.
//
// The split is deliberate. Store review requires a working report mechanism for
// user-generated content, and a report that is never lost is worth shipping
// long before there is anyone reading the queue.

export { buildModerationRouter } from './moderation.routes.js';
export {
  fileReport,
  blockUser,
  unblockUser,
  isBlockedBetween,
  REPORT_REASONS,
} from './moderation.service.js';
export type { ReportReason, SubjectType } from './moderation.service.js';
