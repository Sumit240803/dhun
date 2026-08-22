// Session state — who is signed in.
//
// One of the few things that genuinely belongs in a global store rather than in
// TanStack Query. Everything else the server owns (balances, catalogs, rooms)
// stays in Query, so it can never disagree with itself across screens.
//
// Deliberately not a library: this is a subscribable value with three fields.
// useSyncExternalStore is the React-blessed way to read one, and it keeps the
// store importable from non-React code — which the API client needs, since it
// reads the token on every request.

import { useSyncExternalStore } from 'react';
import type { SessionUser } from '@/api/types';

export interface SessionState {
  /** null until the stored session has been read from secure storage. */
  user: SessionUser | null;
  /** False while bootstrapping, so the splash holds instead of flashing sign-in. */
  isReady: boolean;
}

let state: SessionState = { user: null, isReady: false };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export const sessionStore = {
  get: () => state,

  set(next: Partial<SessionState>) {
    state = { ...state, ...next };
    emit();
  },

  signIn(user: SessionUser) {
    state = { user, isReady: true };
    emit();
  },

  signOut() {
    state = { user: null, isReady: true };
    emit();
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get);
}

/**
 * Has a session at all. A GUEST counts — a guest is a real, authenticated
 * identity on the server that simply has no phone yet, and they can browse,
 * watch and earn free coins.
 */
export function useIsAuthenticated(): boolean {
  return useSession().user !== null;
}

/**
 * Phone verified. Required before anything that spends money.
 *
 * The 18+ check is deliberately NOT here: the backend enforces it per money
 * endpoint and returns DOB_REQUIRED, which the client turns into a date picker.
 * Making it a route guard would lock a user out of screens they should see.
 */
export function useIsRegistered(): boolean {
  return useSession().user?.status === 'active';
}
