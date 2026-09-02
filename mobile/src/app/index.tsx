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
  const { isReady, user } = useSession();
  const isAuthenticated = useIsAuthenticated();

  if (!isReady) return null;
  if (!isAuthenticated) return <Redirect href="/(auth)" />;

  // Checked on EVERY launch, not only at the end of signup.
  //
  // Someone who quit the app during profile setup used to come back
  // authenticated, land on the feed, and never be asked again — leaving a
  // registered account with no name and no date of birth, which then failed
  // every money endpoint with DOB_REQUIRED and no way to fix it.
  //
  // A guest is exempt: they have not started signup, so there is nothing to
  // finish, and sending them here would block browsing entirely.
  if (user?.status !== 'guest' && user?.profileComplete === false) {
    return <Redirect href="/(app)/profile-setup" />;
  }

  return <Redirect href="/(app)/(tabs)" />;
}
