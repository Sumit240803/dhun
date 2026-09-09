// Live rooms: going live, joining, seats, and host moderation.
//
// One thin function per route. The important thing these do NOT have is any
// way to ask for speaking rights — `canPublish` is decided by the server from
// the seat table, and there is no parameter for it anywhere below. That is the
// authorisation boundary of the whole media plane, and it stays server-side.

import { api } from '@/api/client';
import type { JoinedRoom, LiveRoom, RoomSeat, RoomTag, RtcJoinToken } from '@/api/types';

export const liveRoomsApi = {
  /**
   * Starts a broadcast. Returns the room and a token that can speak.
   *
   * `seatCapacity` present makes it a party room with mic seats; absent makes
   * it a single-host broadcast. 409 ALREADY_LIVE carries the existing room id,
   * so the app can offer to reopen it rather than dead-ending.
   */
  goLive: (input: {
    title: string;
    tag: RoomTag;
    isVideo?: boolean;
    seatCapacity?: number;
    coverUrl?: string;
  }) => api.post<{ room: LiveRoom; rtc: RtcJoinToken }>('rooms/live', input),

  /** The room and its seat map, without joining. What a feed card expands into. */
  detail: (roomId: string) => api.get<{ room: LiveRoom; seats: RoomSeat[] }>(`rooms/${roomId}`),

  /**
   * Joins, and returns the credential to connect to the media server.
   *
   * Someone who already holds a seat gets speaking rights back — which is what
   * makes a dropped signal a hiccup rather than losing your place on stage.
   */
  join: (roomId: string) => api.post<JoinedRoom>(`rooms/${roomId}/join`, {}),

  end: (roomId: string) => api.post<{ ended: true }>(`rooms/${roomId}/end`, {}),

  takeSeat: (roomId: string, seatIndex: number) =>
    api.post<{ seated: true }>(`rooms/${roomId}/seats`, { seatIndex }),

  /** Leaving your own seat, or the host removing somebody from theirs. */
  releaseSeat: (roomId: string, userId: string) =>
    api.delete<{ released: true }>(`rooms/${roomId}/seats/${userId}`),

  muteSeat: (roomId: string, userId: string, muted: boolean) =>
    api.post<{ muted: boolean }>(`rooms/${roomId}/seats/${userId}/mute`, { muted }),

  kick: (roomId: string, userId: string, reason?: string) =>
    api.post<{ kicked: true }>(`rooms/${roomId}/kick/${userId}`, reason ? { reason } : {}),
};
