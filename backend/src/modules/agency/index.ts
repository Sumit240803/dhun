// PUBLIC API of the agency module.
//
// Agencies, agents and hosts: who sits where, how a host joins, and how a host
// leaves. No money moves here — commission and coin trading read the dated
// links this module writes. Decisions: CLAUDE.md "Roles", build-plan M12.

export { buildAgencyAdminRouter, buildAgencyRouter } from './agency.routes.js';

export { agencyDetail, listAgencies } from './admin.service.js';
export type { AgencyDetail, AgencySummary, TransferAudit } from './admin.service.js';

export { listAgents } from './agents.service.js';
export type { AgentInvite, RosterAgent } from './agents.service.js';

export { channelConfig, coinsForPrepay, rateFor } from './coins.service.js';
export type { ChannelConfig, Inventory, Prepay, Transfer, TransferCaps } from './coins.service.js';

export {
  agentSeat,
  autoLeaveOverdue,
  currentMembership,
  expireJoinRequests,
  membershipConfig,
} from './agency.service.js';
export type { AgentSeat, AgencyRef, Membership, MembershipConfig } from './agency.service.js';
