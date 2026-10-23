// Whether the new-user sheet is open.
//
// An external store rather than a ref passed around, because two unrelated
// places open it — the once-a-day prompt in the tab layout and the floating
// chest on the home feed — and neither should own the other.

import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (open === next) return;
  open = next;
  listeners.forEach((listener) => listener());
}

export const newUserSheet = {
  open: () => set(true),
  close: () => set(false),
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNewUserSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
