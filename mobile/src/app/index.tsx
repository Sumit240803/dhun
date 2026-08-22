import { Redirect } from 'expo-router';

import { useIsAuthenticated } from '@/store/session';

/**
 * Entry route. The root layout has already restored the session by the time this
 * renders, so this only has to point at the right stack.
 */
export default function Index() {
  const isAuthenticated = useIsAuthenticated();
  return <Redirect href={isAuthenticated ? '/(app)/(tabs)' : '/(auth)/phone'} />;
}
