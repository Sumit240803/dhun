// Over-the-air updates (build-plan M21 slice 4).
//
// Cold starts are handled by expo-updates itself (check on load, apply on the
// next launch). This hook adds the case that matters on Indian phones, where
// the app sits in the background for days: coming back after half an hour
// away, outside a room, checks, fetches, and reloads into the new bundle.
// lib/otaPolicy.ts holds the rule.
//
// Silent by design. A reload after a long absence looks like a launch; asking
// "update now?" would teach people to tap no.
//
// The runtime version is a FINGERPRINT of the native project (app.json), so an
// update only ever reaches a build whose native code matches it. A change that
// needs a store build cannot arrive this way, by construction.

import { usePathname } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { liveSession } from '@/features/room/liveSession';
import { shouldApply, shouldCheck } from '@/lib/otaPolicy';
import { reportMessage } from '@/lib/reporting';

export function useOtaUpdates(): void {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    // Development builds and Expo Go run from the bundler, not from updates.
    if (__DEV__ || !Updates.isEnabled) return;

    let backgroundedAt: number | null = null;
    let busy = false;

    const inRoom = () => pathRef.current.startsWith('/room/') || liveSession.isParked();

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        backgroundedAt = Date.now();
        return;
      }
      if (next !== 'active' || backgroundedAt === null || busy) return;

      const awayMs = Date.now() - backgroundedAt;
      backgroundedAt = null;
      if (!shouldCheck({ awayMs, inRoom: inRoom() })) return;

      busy = true;
      void (async () => {
        try {
          const check = await Updates.checkForUpdateAsync();
          if (!check.isAvailable) return;
          const fetched = await Updates.fetchUpdateAsync();
          // Re-read the room state: a fetch can take seconds, and the person
          // may have opened a room meanwhile.
          if (shouldApply({ awayMs, inRoom: inRoom(), fetched: fetched.isNew })) {
            await Updates.reloadAsync();
          }
          // Otherwise it applies at the next cold start, as expo-updates does anyway.
        } catch (error) {
          // A failed check is usually a phone without a signal. Kept as a
          // warning, never surfaced: the running bundle is still a good one.
          reportMessage('ota check failed', {
            code: 'OTA_CHECK_FAILED',
            reason: error instanceof Error ? error.message : String(error),
          });
        } finally {
          busy = false;
        }
      })();
    });

    return () => sub.remove();
  }, []);
}
