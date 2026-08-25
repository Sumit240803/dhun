// Feed, messages, banners and the profile summary.
//
// All four are REAL now. The mock layer they used to read from is gone — see
// git history for what it looked like, and `docs/` for what still is mocked
// (nothing, at time of writing).

import { useQuery } from '@tanstack/react-query';

import { configApi, messagesApi, roomsApi, usersApi } from '@/api/endpoints/feed';
import { queryKeys } from '@/api/queries/keys';
import type { FeedCategory, ThreadFilter } from '@/api/types';

export function useRoomFeed(category: FeedCategory) {
  return useQuery({
    queryKey: queryKeys.rooms.feed(category),
    queryFn: async () => (await roomsApi.feed(category)).rooms,
    // A live feed is stale the moment it renders — a room that has ended is
    // worse than a room that is missing. Short window, refetched on focus.
    staleTime: 15_000,
  });
}

export function useBanners() {
  return useQuery({
    queryKey: queryKeys.config.banners(),
    queryFn: async () => (await configApi.banners()).banners,
    // Server-driven config on a campaign schedule, not a per-minute one.
    staleTime: 5 * 60_000,
  });
}

export function useMessageThreads(filter: ThreadFilter) {
  return useQuery({
    queryKey: queryKeys.messages.threads(filter),
    queryFn: async () => (await messagesApi.threads(filter)).threads,
    staleTime: 10_000,
  });
}

export function useProfileSummary() {
  return useQuery({
    queryKey: queryKeys.profile.summary(),
    queryFn: async () => (await usersApi.meSummary()).summary,
    staleTime: 60_000,
  });
}
