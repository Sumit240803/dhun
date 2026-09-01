import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { getDeviceId } from '@/features/auth/device';
import { restoreSession } from '@/features/auth/session';
import { UpdateGate } from '@/features/config/UpdateGate';
import { startAnalyticsSession, track } from '@/lib/analytics';
import { initNetworkMonitor } from '@/lib/network';
import { initReporting } from '@/lib/reporting';
import { MODE, colors } from '@/theme';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { useIsAuthenticated, useIsRegistered, useSession } from '@/store/session';

SplashScreen.preventAutoHideAsync();

// Crash reporting starts before anything else, so a failure during bootstrap is
// still captured. No-ops when no DSN is configured.
initReporting();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // The API client already retries what is safe (429, 503, and 5xx on
        // idempotent calls) with backoff and Retry-After. A second layer here
        // would multiply those attempts and turn a busy server into a stampede.
        if (error instanceof ApiError) return false;
        return failureCount < 2;
      },
    },
  },
});

export default function RootLayout() {
  const { isReady } = useSession();
  const isAuthenticated = useIsAuthenticated();
  const isRegistered = useIsRegistered();
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    const stopNetworkMonitor = initNetworkMonitor();

    async function bootstrap() {
      // Stamp the analytics context BEFORE the first event. Without this every
      // event ships with an empty session_id and no device_id, which makes the
      // whole funnel unjoinable — you can count app_opened but you cannot tell
      // whether the same person also finished signup.
      startAnalyticsSession(randomUUID(), await getDeviceId());

      // Read the stored session before choosing a stack, otherwise a returning
      // user sees the login screen before landing on the feed.
      await restoreSession();
      track('app_opened');
    }

    // Marked bootstrapped in EVERY outcome. A throw here must not leave the
    // splash screen up forever with no way out.
    bootstrap().finally(() => setBootstrapped(true));

    return stopNetworkMonitor;
  }, []);

  const ready = bootstrapped && isReady;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // NEVER return null here.
  //
  // The navigator has to mount on the first render. expo-router resolves the
  // initial deep link in a promise and sets state when it lands; if the tree
  // was still null at that moment it sets state on a component that never
  // mounted, which is a red screen in development and a dropped deep link in
  // production. The splash screen — held open until `ready` above — is what
  // hides the frame or two before the session is known, and it is the reason
  // SplashScreen.preventAutoHideAsync() is called at module load.
  //
  // The guards below still do the real work: until the session is restored
  // both are false, so neither stack is reachable and there is nothing to
  // flash even if the splash were not there.

  return (
    // GestureHandlerRootView must be the outermost view or bottom sheets and
    // swipe gestures silently do nothing on Android.
    <GestureHandlerRootView style={styles.root}>
      {/*
        Outermost boundary: catches anything the per-screen boundaries miss, so
        a render error shows a recoverable panel instead of a white screen.
      */}
      <ErrorBoundary screen="root">
        <QueryClientProvider client={queryClient}>
          <KeyboardProvider>
            <SafeAreaProvider>
              <BottomSheetModalProvider>
                {/*
                  Wraps the whole navigator, not a screen: a required update
                  must not be reachable by deep link, by a notification tap, or
                  by a session that was already open.
                */}
                <UpdateGate>
                  {/* Inverted against the page: dark glyphs on a light app. */}
                  <StatusBar style={MODE === 'light' ? 'dark' : 'light'} />
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: { backgroundColor: colors.bg.base },
                      animation: 'slide_from_right',
                    }}
                  >
                    {/*
                    Stack.Protected rather than redirect effects. Declarative, and it
                    CLEANS NAVIGATION HISTORY when a screen becomes inaccessible — so a
                    signed-out user cannot swipe back into the wallet.

                    The auth stack is gated on REGISTERED, not on authenticated. A guest
                    is authenticated — they hold a real server-side identity — and gating
                    on that would lock them out of the very screen that upgrades them to
                    a phone account. Profile setup lives in (app) for the mirror reason:
                    it runs AFTER verification, by which point this guard is already false.
                  */}
                    <Stack.Protected guard={!isRegistered}>
                      <Stack.Screen name="(auth)" />
                    </Stack.Protected>

                    <Stack.Protected guard={isAuthenticated}>
                      <Stack.Screen name="(app)" />
                    </Stack.Protected>

                    {/*
                    Legal routes are reachable without a session. IT Rules 2021 require
                    the Grievance Officer contact to be publicly published, and store
                    review asks to see the privacy policy and community guidelines.
                  */}
                    <Stack.Screen name="legal" options={{ presentation: 'modal' }} />
                  </Stack>
                </UpdateGate>
              </BottomSheetModalProvider>
            </SafeAreaProvider>
          </KeyboardProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
