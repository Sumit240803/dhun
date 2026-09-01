// Feed, messages, profile summary and server-driven config.
//
// One thin function per route. No React, no state, no error handling beyond
// what the client already does — these exist so a feature never builds a URL
// by hand.

import { api } from '@/api/client';
import type {
  AppBanner,
  ClientConfig,
  FeedCategory,
  FeedRoom,
  MessageThread,
  ProfileSummary,
  ThreadFilter,
  ThreadMessage,
  Visitor,
} from '@/api/types';

export const roomsApi = {
  /**
   * Anonymous on purpose: browsing is the top of the funnel, and a signed-out
   * user has to see what the app IS before being asked for a phone number.
   * `following` needs a session and returns empty without one.
   */
  feed: (category: FeedCategory, limit = 20) =>
    api.get<{ rooms: FeedRoom[] }>(`rooms/feed?category=${category}&limit=${limit}`),
};

export const messagesApi = {
  threads: (filter: ThreadFilter, limit = 30) =>
    api.get<{ threads: MessageThread[] }>(`messages/threads?filter=${filter}&limit=${limit}`),

  messages: (threadId: string, limit = 50) =>
    api.get<{ messages: ThreadMessage[] }>(`messages/threads/${threadId}/messages?limit=${limit}`),

  /** Moves the read watermark. Idempotent, so it is safe on every open. */
  markRead: (threadId: string) => api.post<{ read: true }>(`messages/threads/${threadId}/read`, {}),
};

export const usersApi = {
  meSummary: () => api.get<{ summary: ProfileSummary }>('users/me/summary'),

  visitors: (limit = 50) => api.get<{ visitors: Visitor[] }>(`users/me/visitors?limit=${limit}`),
  markVisitorsSeen: () => api.post<{ cleared: number }>('users/me/visitors/seen', {}),

  // Both idempotent on the server, which is what lets the client fire them
  // optimistically and reconcile afterwards rather than blocking the tap.
  follow: (userId: string) => api.post<{ following: boolean }>(`users/${userId}/follow`, {}),
  unfollow: (userId: string) => api.delete<{ following: boolean }>(`users/${userId}/follow`),

  /** Fire-and-forget. A failed visit record must never interrupt a screen. */
  recordVisit: (userId: string) => api.post<void>(`users/${userId}/visit`, {}),
};

export const configApi = {
  banners: () => api.get<{ banners: AppBanner[] }>('config/banners'),
  /** Anonymous: a force-update has to reach a user who cannot sign in. */
  app: () => api.get<{ config: ClientConfig }>('config/app', { anonymous: true }),
};
