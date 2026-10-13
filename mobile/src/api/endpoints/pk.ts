// PK battles.
//
// One thing these do NOT have, and it is the point: an `Idempotency-Key`.
// Nothing here moves coins. A battle is a scoreboard over gifts that `gifting`
// already settled through the ledger when they were sent. If a function in
// this file ever needs an idempotency key, somebody is about to settle a wager
// — see backend migration 028 and hard rule #1.

import { api } from '@/api/client';
import type { PkBattle } from '@/api/types';

export interface PkInvite {
  id: string;
  fromUserId: string;
  displayName: string | null;
  expiresAt: string;
}

export const pkApi = {
  /** Mostly so the app knows whether to show the battle button at all. */
  config: () =>
    api.get<{
      enabled: boolean;
      durationSeconds: number;
      minDurationSeconds: number;
      maxDurationSeconds: number;
    }>('pk/config'),

  /** The battle a room is in, or null. Read on joining, then pushed. */
  forRoom: (roomId: string) => api.get<{ pk: PkBattle | null }>(`pk/rooms/${roomId}`),

  battle: (battleId: string) => api.get<{ pk: PkBattle }>(`pk/battles/${battleId}`),

  inbox: () => api.get<{ invites: PkInvite[] }>('pk/invites'),

  invite: (toUserId: string) =>
    api.post<{ inviteId: string; expiresAt: string }>('pk/invites', { toUserId }),

  /** The window is the ACCEPTING host's choice — they agree to be on camera for it. */
  accept: (inviteId: string, durationSeconds?: number) =>
    api.post<{ pk: PkBattle }>(
      `pk/invites/${inviteId}/accept`,
      durationSeconds === undefined ? {} : { durationSeconds },
    ),

  decline: (inviteId: string) => api.post<void>(`pk/invites/${inviteId}/decline`, {}),

  /** The "Random PK" queue. Matching happens server-side; the result arrives pushed. */
  joinQueue: () => api.post<{ position: number }>('pk/queue', {}),
  leaveQueue: () => api.delete<void>('pk/queue'),

  /**
   * Give up.
   *
   * Settles on the scores as they stand rather than voiding the battle — so
   * forfeiting while ahead still wins, which is correct: they earned it.
   */
  forfeit: (battleId: string) => api.post<{ pk: PkBattle }>(`pk/battles/${battleId}/forfeit`, {}),
};
