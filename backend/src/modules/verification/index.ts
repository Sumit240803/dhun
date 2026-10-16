// PUBLIC API of the verification module.
//
// Host identity: the one-time check (phone OTP + a face photo reviewed by a
// human) and the frame captured at every go-live.
//
// ── The rule that shapes this module ────────────────────────────────────────
//
// GOING LIVE IS NOT GATED ON A FACE CHECK. The frame is captured and queued;
// the host streams immediately. A gate fails on real hosts in bad light, and
// every false reject is a host who cannot earn — in a category where host
// supply is the thing most likely to kill the product.
//
// What makes a late catch good enough is the payout hold: earnings sit 7–14
// days before they can be withdrawn, so a handoff caught within a day is
// caught long before any money leaves. Suspension stops future earning; the
// hold stops past earning from leaving.
//
// The ONE hard stop is suspension — see `assertMayGoLive`.
//
// Migration 031's header has the long version.

export {
  assertMayGoLive,
  recordFaceCheck,
  reasonToReview,
  submitVerification,
  verificationConfig,
  verificationFor,
} from './verification.service.js';
export type { CheckReason, HostVerification, VerificationConfig } from './verification.service.js';

export {
  assertSubjectExists,
  enforce,
  enforcementHistory,
  recentEnforcement,
} from './enforcement.service.js';
export type { EnforcementAction, EnforcementEntry } from './enforcement.service.js';

export {
  decideFaceCheck,
  decideVerification,
  pendingFaceChecks,
  pendingVerifications,
  queueCounts,
} from './queue.service.js';
export type { PendingFaceCheck, PendingVerification } from './queue.service.js';

export { buildVerificationRouter } from './verification.routes.js';
