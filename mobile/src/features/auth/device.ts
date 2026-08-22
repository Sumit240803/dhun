// Device identity.
//
// The backend keys two of its six fraud signals off this ("same device, 5+
// accounts") and rate-limits guest creation per device, so it has to be stable
// across launches and reinstalls where the platform allows.
//
// Generated rather than read from the hardware: Android's SSAID and iOS's
// identifierForVendor are both unavailable or unstable in the cases we care
// about, and neither should be treated as trustworthy anyway — the server
// assumes a client can lie about this and layers IP limits underneath.

import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { deviceStorage } from './storage';
import type { DevicePayload } from '@/api/types';

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;

  const stored = await deviceStorage.get();
  if (stored) {
    cached = stored;
    return stored;
  }

  const fresh = randomUUID();
  await deviceStorage.set(fresh);
  cached = fresh;
  return fresh;
}

export async function getDevicePayload(pushToken?: string): Promise<DevicePayload> {
  return {
    deviceId: await getDeviceId(),
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    appVersion: Application.nativeApplicationVersion ?? undefined,
    ...(pushToken ? { pushToken } : {}),
  };
}
