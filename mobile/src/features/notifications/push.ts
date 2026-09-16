// Push notifications: permission, the token, and what a tap opens.
//
// Permission is asked at a moment that EXPLAINS it — right after following
// someone, when "tell me when they go live" is obviously what a notification
// is for. Asking on first launch, before the app has shown anything worth
// being notified about, is how most apps get a permanent no.

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { pushApi } from '@/api/endpoints/growth';
import { getDeviceId } from '@/features/auth/device';
import { track } from '@/lib/analytics';
import { reportError } from '@/lib/reporting';
import { useIsAuthenticated } from '@/store/session';

// Shown even while the app is open: "your host is live" is worth seeing whether
// or not someone happens to be scrolling the feed at that second.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Android files notifications into channels; the server sends to this one. */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('live', {
    name: 'Live now',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/**
 * Registers this device for push, asking for permission only when `ask` is set.
 *
 * Never throws. Push is a courtesy — a failure here must not surface as an
 * error on the follow that triggered it.
 */
export async function registerForPush({ ask }: { ask: boolean }): Promise<void> {
  try {
    await ensureChannel();

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      if (!ask) return;
      status = (await Notifications.requestPermissionsAsync()).status;
      if (status !== 'granted') return;
      track('notification_permission_granted');
    }

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    await pushApi.register(await getDeviceId(), token);
  } catch (error) {
    // Most commonly: no Firebase credentials in a development build, which is
    // expected until they are configured. Reported, never shown.
    reportError(error, { code: 'PUSH_REGISTER_FAILED' });
  }
}

/**
 * Keeps the token fresh and routes taps.
 *
 * Mounted once, inside the navigator. A token can rotate (reinstall, restore),
 * so a session that already granted permission re-registers on every launch —
 * silently, without asking again.
 */
export function usePushNotifications(): void {
  const isAuthenticated = useIsAuthenticated();

  useEffect(() => {
    if (isAuthenticated) void registerForPush({ ask: false });
  }, [isAuthenticated]);

  useEffect(() => {
    function open(response: Notifications.NotificationResponse) {
      const data = response.notification.request.content.data as { type?: string; roomId?: string };
      track('push_opened', { type: data.type ?? 'unknown' });
      if (data.type === 'room_live' && typeof data.roomId === 'string') {
        router.push({ pathname: '/(app)/room/[id]', params: { id: data.roomId } });
      }
    }

    // The tap that LAUNCHED the app, when it was not running.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response);
    });

    const tapped = Notifications.addNotificationResponseReceivedListener(open);
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as { type?: string };
      track('push_received', { type: data.type ?? 'unknown' });
    });

    return () => {
      tapped.remove();
      received.remove();
    };
  }, []);
}
