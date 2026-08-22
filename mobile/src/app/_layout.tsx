import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { restoreSession } from '@/features/auth/session';
import { track } from '@/lib/analytics';
import { initNetworkMonitor } from '@/lib/network';
import { initReporting } from '@/lib/reporting';
import { colors } from '@/theme';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { useIsAuthenticated, useSession } from '@/store/session';

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
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    const stopNetworkMonitor = initNetworkMonitor();

    // Read the stored session before choosing a stack, otherwise a returning
    // user sees the phone screen flash before landing on the feed.
    restoreSession()
      .finally(() => setBootstrapped(true))
      .then(() => track('app_opened'));

    return stopNetworkMonitor;
  }, []);

  useEffect(() => {
    if (bootstrapped && isReady) void SplashScreen.hideAsync();
  }, [bootstrapped, isReady]);

  if (!bootstrapped || !isReady) return null; // splash stays up

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
                <StatusBar style="light" />
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
                  */}
                  <Stack.Protected guard={!isAuthenticated}>
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
