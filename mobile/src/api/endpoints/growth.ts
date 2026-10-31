// Rewards, search and push — the M10 surface.

import { api } from '@/api/client';
import type {
  DailyTasks,
  FeedRoom,
  NewUserRewards,
  NewUserTaskId,
  PersonResult,
  RewardsStatus,
  RoomResult,
} from '@/api/types';

export const rewardsApi = {
  status: () => api.get<{ rewards: RewardsStatus }>('rewards'),
  // No idempotency key: the server derives one from the claim itself, so a
  // retried claim is the same claim.
  claimWelcome: () => api.post<{ coins: number; alreadyClaimed: boolean }>('rewards/welcome', {}),
  checkin: () =>
    api.post<{ coins: number; streakDay: number; alreadyClaimed: boolean }>('rewards/checkin', {}),
  newUser: () => api.get<{ newUser: NewUserRewards | null }>('rewards/new-user'),
  claimNewUser: (task: NewUserTaskId) =>
    api.post<{ coins: number; alreadyClaimed: boolean }>(`rewards/new-user/${task}`, {}),
  enterCode: (code: string) =>
    api.post<{ referrerName: string | null }>('rewards/referral', { code }),

  // Daily tasks. Progress is the server's; a claim pays once per task per day.
  tasks: () => api.get<{ tasks: DailyTasks }>('rewards/tasks'),
  claimTask: (taskId: string) =>
    api.post<{ coins: number; alreadyClaimed: boolean }>(`rewards/tasks/${taskId}`, {}),
  /** The share sheet closed. Recorded once a day; the claim is separate. */
  recordShare: () => api.post<{ tasks: DailyTasks }>('rewards/tasks/share', {}),
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
