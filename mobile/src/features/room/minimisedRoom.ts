// Which room is playing in the background, if any.
//
// An external store rather than context: the room screen writes it on the way
// out, the app layout's mini player reads it, and neither is above the other
// in the tree.

import { useSyncExternalStore } from 'react';

export interface MinimisedRoom {
  roomId: string;
  title: string;
  hostName: string | null;
  coverUrl: string | null;
}

let current: MinimisedRoom | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export const minimisedRoom = {
  get: (): MinimisedRoom | null => current,
  set(room: MinimisedRoom): void {
    current = room;
    emit();
  },
  clear(): void {
    if (current === null) return;
    current = null;
    emit();
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMinimisedRoom(): MinimisedRoom | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
