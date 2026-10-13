import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Who has a camera on, shared with everything that draws a person.
 *
 * ── Why a context and not a prop ────────────────────────────────────────────
 *
 * Three different stages draw video — the two-tile video stage, the PK stage
 * and the mic rail — and each of them is several components deep. Threading a
 * track map through `Stage → VideoStage → VideoTile → RemoteVideo` means every
 * one of those files has a prop it does not use, and adding a fourth place that
 * needs video means editing all of them again.
 *
 * The map is also the kind of value a context is actually for: it is read by
 * many, written by exactly one (`useLiveRoom`), and identity-stable between
 * media events.
 *
 * Tracks are typed as `unknown` on purpose. `RemoteVideo` is the single place
 * that hands one to the SDK, so it is also the single place that needs the
 * SDK's types — and that keeps `livekit-client` out of the import graph of
 * every component that merely sits near a video tile.
 */
const RoomMediaContext = createContext<ReadonlyMap<string, unknown>>(new Map());

export function RoomMediaProvider({
  videoTracks,
  children,
}: {
  videoTracks: ReadonlyMap<string, unknown>;
  children: ReactNode;
}) {
  // The map identity already changes only when `useLiveRoom` rebuilds it, so
  // this memo is about the CHILDREN: without it every consumer re-renders on
  // each parent render, and the parent here is a room that re-renders on every
  // chat line.
  const value = useMemo(() => videoTracks, [videoTracks]);
  return <RoomMediaContext.Provider value={value}>{children}</RoomMediaContext.Provider>;
}

/** This person's camera track, or null — which is the ordinary case. */
export function useRemoteVideoTrack(userId: string): unknown | null {
  return useContext(RoomMediaContext).get(userId) ?? null;
}

/** Whether anybody on this list is on camera. Decides if a stage shows tiles. */
export function useAnyVideo(userIds: string[]): boolean {
  const tracks = useContext(RoomMediaContext);
  return userIds.some((id) => tracks.has(id));
}
