// Agency membership — the M12 surface. No money moves through any of these.

import { api } from '@/api/client';
import type { AgencyMembership, JoinRequest, MyAgency, QuitRequest } from '@/api/types';

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
};
