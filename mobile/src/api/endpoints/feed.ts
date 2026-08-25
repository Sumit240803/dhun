// Feed, messages, profile summary and server-driven config.
//
// One thin function per route. No React, no state, no error handling beyond
// what the client already does — these exist so a feature never builds a URL
// by hand.

import { api } from '@/api/client';
import type {
  AppBanner,
  FeedCategory,
  FeedRoom,
  MessageThread,
  ProfileSummary,
  ThreadFilter,
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
};

export const usersApi = {
  meSummary: () => api.get<{ summary: ProfileSummary }>('users/me/summary'),
};

export const configApi = {
  banners: () => api.get<{ banners: AppBanner[] }>('config/banners'),
};
