// PUBLIC API of the agency module.
//
// Agencies, agents and hosts: who sits where, how a host joins, and how a host
// leaves. No money moves here — commission and coin trading read the dated
// links this module writes. Decisions: CLAUDE.md "Roles", build-plan M12.

export { buildAgencyAdminRouter, buildAgencyRouter } from './agency.routes.js';

export {
  agentSeat,
  autoLeaveOverdue,
  currentMembership,
  expireJoinRequests,
  membershipConfig,
} from './agency.service.js';
export type { AgentSeat, AgencyRef, Membership, MembershipConfig } from './agency.service.js';
