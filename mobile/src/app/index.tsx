import { Redirect } from 'expo-router';

import { useIsAuthenticated, useSession } from '@/store/session';

/**
 * Entry route. Decides which stack the app opens on.
 *
 * Holds — renders nothing — until the stored session has been read. This is a
 * SCREEN returning null, which is fine and is not the same as the root layout
 * returning null: the navigator above is already mounted, so expo-router's
 * initial-link resolution has something to set state on.
 *
 * Redirecting before the session is known would send a returning user to the
 * login screen and leave them there, because this route unmounts the moment it
 * navigates and never gets a second chance to correct itself. The splash screen
 * covers the wait.
 */
export default function Index() {
  const { isReady } = useSession();
  const isAuthenticated = useIsAuthenticated();

  if (!isReady) return null;

  return <Redirect href={isAuthenticated ? '/(app)/(tabs)' : '/(auth)'} />;
}
