// Rewards, search and push — the M10 surface.

import { api } from '@/api/client';
import type { FeedRoom, PersonResult, RewardsStatus, RoomResult } from '@/api/types';

export const rewardsApi = {
  status: () => api.get<{ rewards: RewardsStatus }>('rewards'),
  // No idempotency key: the server derives one from the claim itself, so a
  // retried claim is the same claim.
  claimWelcome: () => api.post<{ coins: number; alreadyClaimed: boolean }>('rewards/welcome', {}),
  checkin: () =>
    api.post<{ coins: number; streakDay: number; alreadyClaimed: boolean }>('rewards/checkin', {}),
  enterCode: (code: string) =>
    api.post<{ referrerName: string | null }>('rewards/referral', { code }),
};

export const discoverApi = {
  search: (q: string, signal?: AbortSignal) =>
    api.get<{ people: PersonResult[]; rooms: RoomResult[] }>(
      `discover/search?q=${encodeURIComponent(q)}`,
      { signal },
    ),
  fullestRoom: () => api.get<{ room: FeedRoom | null }>('rooms/fullest'),
};

export const pushApi = {
  register: (deviceId: string, token: string) =>
    api.post<{ registered: boolean }>('notifications/token', { deviceId, token }, { retries: 1 }),
};
