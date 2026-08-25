// Feed, messages and profile summary.
//
// Every queryFn here is ONE LINE from being real. The mock import and the
// `fromMock(...)` call are the whole of the temporary code; the query keys,
// stale times, and every screen that consumes these stay exactly as they are.

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/api/queries/keys';
import {
  fromMock,
  mockBanners,
  mockProfileSummary,
  mockRooms,
  mockThreads,
  type RoomCategory,
  type ThreadFilter,
} from '@/mocks';

export function useRoomFeed(category: RoomCategory) {
  return useQuery({
    queryKey: queryKeys.rooms.feed(category),
    queryFn: () => fromMock(mockRooms(category)), // TODO(api): roomsApi.feed(category)
    // A live feed is stale the moment it renders — a room that ended is worse
    // than a room that is missing. Short window, refetched on focus.
    staleTime: 15_000,
  });
}

export function useBanners() {
  return useQuery({
    queryKey: queryKeys.config.banners(),
    queryFn: () => fromMock(mockBanners()), // TODO(api): configApi.banners()
    // Server-driven config that changes on a campaign schedule, not per minute.
    staleTime: 5 * 60_000,
  });
}

export function useMessageThreads(filter: ThreadFilter) {
  return useQuery({
    queryKey: queryKeys.messages.threads(filter),
    queryFn: () => fromMock(mockThreads(filter)), // TODO(api): messagesApi.threads(filter)
    staleTime: 10_000,
  });
}

export function useProfileSummary() {
  return useQuery({
    queryKey: queryKeys.profile.summary(),
    queryFn: () => fromMock(mockProfileSummary()), // TODO(api): usersApi.meSummary()
    staleTime: 60_000,
  });
}
