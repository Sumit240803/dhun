// Live rooms: going live, joining, seats, and host moderation.
//
// One thin function per route. The important thing these do NOT have is any
// way to ask for speaking rights — `canPublish` is decided by the server from
// the seat table, and there is no parameter for it anywhere below. That is the
// authorisation boundary of the whole media plane, and it stays server-side.

import { api } from '@/api/client';
import type { JoinedRoom, LiveRoom, RoomRank, RoomSeat, RoomTag, RtcJoinToken } from '@/api/types';

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
    coverKey?: string;
    /**
     * A selfie taken as they tapped Go Live.
     *
     * Optional, and NEVER a gate. The server queues it for a moderator and
     * the broadcast starts regardless — a missing frame is a gap in a review
     * queue, where a refused go-live is a host who cannot earn tonight.
     */
    faceKey?: string;
    /** So "this account streams from four phones" is answerable. */
    deviceId?: string;
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

  /**
   * Where this room stands on the hourly board.
   *
   * `null` when it has earned nothing this hour — a host is not shown a zero.
   * Read from a rollup refreshed every 60s server-side, so polling faster
   * than that reads a number that has not changed.
   */
  rank: (roomId: string) => api.get<{ rank: RoomRank | null }>(`rooms/${roomId}/rank`),

  /** Find a LIVE room by the short number its host read out. 404 otherwise. */
  byCode: (code: number) => api.get<{ room: LiveRoom; seats: RoomSeat[] }>(`rooms/code/${code}`),

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
