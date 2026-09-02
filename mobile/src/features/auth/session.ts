// Session lifecycle: restore on launch, wire the API client, sign out.
//
// This is the bridge between the API client (which knows nothing about React)
// and the session store (which the UI reads). Wiring it in one place is what
// lets `apiRequest` fetch a token and trigger a refresh without importing a
// component.

import { api, configureApiClient } from '@/api/client';
import type { SessionResponse, SessionUser, TokenPair } from '@/api/types';
import { sessionStore } from '@/store/session';
import { tokenStorage } from './storage';

/**
 * Exchanges the stored refresh token for a new pair.
 *
 * Returns null rather than throwing on failure — the caller (the API client)
 * treats null as "the session is over" and the user is signed out cleanly.
 */
async function refreshTokens(): Promise<TokenPair | null> {
  const refreshToken = await tokenStorage.getRefresh();
  if (!refreshToken) return null;

  try {
    const tokens = await api.post<TokenPair>(
      'auth/refresh',
      { refreshToken },
      // anonymous: the whole point is that the access token is expired.
      // retries 0: a refresh is single-use, and the client already serialises
      // concurrent refreshes into one call.
      { anonymous: true, retries: 0 },
    );
    await tokenStorage.save(tokens);
    return tokens;
  } catch {
    return null;
  }
}

configureApiClient({
  getAccessToken: () => tokenStorage.getAccess(),
  refreshTokens,
  onSessionEnded: (reason) => {
    // Reached when a refresh fails, or when the backend detects a replayed
    // refresh token and revokes the whole device chain. Either way there is
    // nothing to salvage.
    if (__DEV__) console.warn('[session] ended:', reason);
    void signOut();
  },
});

/**
 * Called once at launch, before the router decides which stack to show.
 *
 * Marks the session ready in every outcome — a thrown error here must not leave
 * the splash screen up forever.
 */
export async function restoreSession(): Promise<void> {
  try {
    const accessToken = await tokenStorage.getAccess();
    if (!accessToken) {
      sessionStore.set({ user: null, isReady: true });
      return;
    }

    // /me is the cheapest way to find out whether the stored token is still
    // good. If it is not, the API client refreshes transparently first.
    const { user } = await api.get<{ user: SessionUser }>('auth/me');
    sessionStore.signIn(user);
  } catch {
    await tokenStorage.clear();
    sessionStore.set({ user: null, isReady: true });
  }
}

/** Persists a fresh sign-in and puts the user into the store. */
export async function adoptSession(response: SessionResponse): Promise<void> {
  await tokenStorage.save({
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
  });
  sessionStore.signIn(response.user);
}

/**
 * Re-reads the signed-in user.
 *
 * For the cases where the SERVER changed something the store is caching —
 * confirming an email, finishing a profile. Re-reading is cheaper and far less
 * error-prone than patching the store field by field and hoping every screen
 * that derives from it agrees.
 */
export async function refreshSessionUser(): Promise<void> {
  try {
    const { user } = await api.get<{ user: SessionUser }>('auth/me');
    sessionStore.signIn(user);
  } catch {
    // Leave the current user in place. A failed refresh must not sign someone
    // out of a session that is still perfectly valid.
  }
}

export async function signOut(): Promise<void> {
  const refreshToken = await tokenStorage.getRefresh();

  // Best effort: tell the server to revoke the token, but never block the local
  // sign-out on a network call. A user tapping "log out" on a dead connection
  // must still end up logged out.
  if (refreshToken) {
    void api.post('auth/logout', {}, { retries: 0 }).catch(() => undefined);
  }

  await tokenStorage.clear();
  sessionStore.signOut();
}
