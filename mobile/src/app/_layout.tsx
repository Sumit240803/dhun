import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { restoreSession } from '@/features/auth/session';
import { colors } from '@/theme';
import { useIsAuthenticated, useSession } from '@/store/session';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // The API client already retries what is safe to retry (429, 503, and
        // 5xx on idempotent calls). A second layer here would multiply those
        // attempts and turn a busy server into a stampede.
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
    // Read the stored session before deciding which stack to show, otherwise a
    // returning user sees the phone screen flash before landing on the feed.
    restoreSession().finally(() => setBootstrapped(true));
  }, []);

  useEffect(() => {
    if (bootstrapped && isReady) void SplashScreen.hideAsync();
  }, [bootstrapped, isReady]);

  if (!bootstrapped || !isReady) return null; // splash stays up

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg.base },
            animation: 'slide_from_right',
          }}
        >
          {/*
            Stack.Protected rather than redirect effects. It is declarative, and
            it CLEANS NAVIGATION HISTORY when a screen becomes inaccessible — so
            a signed-out user cannot swipe back into the wallet.
          */}
          <Stack.Protected guard={!isAuthenticated}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>

          <Stack.Protected guard={isAuthenticated}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>

          {/*
            Legal pages are reachable without a session. IT Rules 2021 require
            the Grievance Officer contact to be publicly published, and store
            review asks to see the privacy policy and community guidelines.
          */}
          <Stack.Screen name="legal" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
