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
/**
 * Where this room stands on the hourly board.
 *
 * Polled at the rollup's own cadence and no faster: the server recomputes the
 * board once a minute, so a 10-second poll would read the same number six
 * times and cost six requests per viewer to do it.
 *
 * `null` is an ordinary answer — a room nobody has gifted in this hour has not
 * entered the board, and the rail hides rather than showing a host a zero.
 */
export function useRoomRank(roomId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.rooms.rank(roomId ?? ''),
    queryFn: async () => (await liveRoomsApi.rank(roomId!)).rank,
    enabled: enabled && roomId !== undefined,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
}

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
