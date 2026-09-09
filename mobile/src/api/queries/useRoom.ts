// Live-room queries and mutations.
//
// Joining is a MUTATION, not a query, even though it mostly reads. It mints a
// short-lived credential and has a server-side effect, so it must not be
// retried, refetched on focus, or replayed from cache — all of which a query
// would happily do, each time handing the screen a token that had already been
// superseded.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { liveRoomsApi } from '@/api/endpoints/rooms';
import { queryKeys } from '@/api/queries/keys';
import type { RoomTag } from '@/api/types';

/**
 * The seat map, polled while the screen is open.
 *
 * Polling rather than pushed, because the WebSocket gateway that would push it
 * is M5 and not built. Three seconds is a deliberate compromise: fast enough
 * that a seat change feels immediate, slow enough that twenty people in a room
 * are not twenty requests a second.
 *
 * This is the first thing the gateway replaces.
 */
export function useRoomDetail(roomId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.rooms.detail(roomId),
    queryFn: () => liveRoomsApi.detail(roomId),
    enabled,
    refetchInterval: 3_000,
    staleTime: 0,
  });
}

export function useJoinRoom() {
  return useMutation({
    mutationFn: (roomId: string) => liveRoomsApi.join(roomId),
    // Never. A failed join is shown to the user with a retry they choose —
    // silently re-requesting a room they were banned from is noise.
    retry: false,
  });
}

export function useGoLive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      title: string;
      tag: RoomTag;
      seatCapacity?: number;
      isVideo?: boolean;
    }) => liveRoomsApi.goLive(input),
    onSuccess: () => {
      // The feed now contains a room it did not a moment ago, and the host is
      // about to navigate somewhere that shows it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
    },
    retry: false,
  });
}

/** Seat and moderation actions, all invalidating the same seat map. */
export function useRoomActions(roomId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms.detail(roomId) });

  const takeSeat = useMutation({
    mutationFn: (seatIndex: number) => liveRoomsApi.takeSeat(roomId, seatIndex),
    onSuccess: refresh,
    retry: false,
  });

  const releaseSeat = useMutation({
    mutationFn: (userId: string) => liveRoomsApi.releaseSeat(roomId, userId),
    onSuccess: refresh,
    retry: false,
  });

  const muteSeat = useMutation({
    mutationFn: (input: { userId: string; muted: boolean }) =>
      liveRoomsApi.muteSeat(roomId, input.userId, input.muted),
    onSuccess: refresh,
    retry: false,
  });

  const kick = useMutation({
    mutationFn: (userId: string) => liveRoomsApi.kick(roomId, userId),
    onSuccess: () => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
    },
    retry: false,
  });

  const endRoom = useMutation({
    mutationFn: () => liveRoomsApi.end(roomId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all }),
    retry: false,
  });

  return { takeSeat, releaseSeat, muteSeat, kick, endRoom };
}
