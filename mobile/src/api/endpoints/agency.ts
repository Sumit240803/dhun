// Agency membership — the M12 surface. No money moves through any of these.

import { api } from '@/api/client';
import type {
  AgencyInventory,
  AgencyMembership,
  AgencyPerson,
  AgentInvite,
  CoinTransfer,
  JoinRequest,
  MyAgency,
  QuitRequest,
  RosterAgent,
} from '@/api/types';

export const agencyApi = {
  me: () => api.get<MyAgency>('agency/me'),
  hostCode: () => api.get<{ code: string; rotatedAt: string }>('agency/host-code'),
  rotateHostCode: () =>
    api.post<{ code: string; rotatedAt: string }>('agency/host-code/rotate', {}),

  join: (agentId: number) => api.post<{ request: JoinRequest }>('agency/join', { agentId }),
  invite: (userId: number, hostCode: string) =>
    api.post<{ request: JoinRequest }>('agency/invites', { userId, hostCode }),

  requests: () => api.get<{ asHost: JoinRequest[]; asAgent: JoinRequest[] }>('agency/requests'),
  accept: (id: string) =>
    api.post<{ request: JoinRequest; membership: AgencyMembership | null }>(
      `agency/requests/${id}/accept`,
      {},
    ),
  decline: (id: string) => api.post<{ request: JoinRequest }>(`agency/requests/${id}/decline`, {}),
  cancel: (id: string) => api.post<{ request: JoinRequest }>(`agency/requests/${id}/cancel`, {}),

  quit: (reason: string) =>
    api.post<{ outcome: 'left' | 'pending'; request: QuitRequest }>('agency/quit', { reason }),
  quitRequests: () => api.get<{ requests: QuitRequest[] }>('agency/quit-requests'),
  approveQuit: (id: string) =>
    api.post<{ request: QuitRequest }>(`agency/quit-requests/${id}/approve`, {}),
  rejectQuit: (id: string) =>
    api.post<{ request: QuitRequest }>(`agency/quit-requests/${id}/reject`, {}),

  inventory: () => api.get<AgencyInventory>('agency/inventory'),
  // requestId is the idempotency: the same one retried moves the coins once.
  transfer: (body: { userId: number; coins: number; requestId: string; note?: string }) =>
    api.post<{ transfer: CoinTransfer }>('agency/transfers', body),
  transfers: () => api.get<{ transfers: CoinTransfer[] }>('agency/transfers?limit=50'),
  received: () => api.get<{ transfers: CoinTransfer[] }>('agency/received?limit=50'),

  agents: () => api.get<{ agents: RosterAgent[] }>('agency/agents'),
  agentHosts: (agentId: string) =>
    api.get<{ hosts: (AgencyPerson & { userId: string })[] }>(`agency/agents/${agentId}/hosts`),
  agentInvites: () =>
    api.get<{ mine: AgentInvite[]; sent: AgentInvite[] }>('agency/agents/invites'),
  inviteAgent: (body: { userId: number; canManageAgents?: boolean; message?: string }) =>
    api.post<{ invite: AgentInvite }>('agency/agents/invites', body),
  answerAgentInvite: (id: string, accept: boolean) =>
    api.post<{ invite: AgentInvite }>(
      `agency/agents/invites/${id}/${accept ? 'accept' : 'decline'}`,
      {},
    ),
  cancelAgentInvite: (id: string) =>
    api.post<{ invite: AgentInvite }>(`agency/agents/invites/${id}/cancel`, {}),
  removeAgent: (id: string) =>
    api.post<{ removed: string; hostsMoved: number }>(`agency/agents/${id}/remove`, {}),
  setAgentManagement: (id: string, canManageAgents: boolean) =>
    api.post<{ agent: RosterAgent }>(`agency/agents/${id}/management`, { canManageAgents }),
};
