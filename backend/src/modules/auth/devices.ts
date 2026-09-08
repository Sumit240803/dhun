// The device a session belongs to.
//
// Split out of auth.service so EVERY sign-in path can record one. It used to
// live there as a private helper, which meant the phone paths recorded a device
// and the email paths silently did not — so an email account had no push token
// to notify, and nothing to show on a "where am I signed in" screen.

import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';

export interface DeviceInfo {
  deviceId: string;
  platform: 'android' | 'ios' | 'web';
  appVersion?: string;
  pushToken?: string;
}

/**
 * Records the device, or refreshes what is already known about it.
 *
 * COALESCE rather than a plain overwrite: a sign-in that happens before the
 * push permission prompt carries no token, and assigning null there would erase
 * a working one.
 */
export async function upsertDevice(
  client: PoolClient,
  userId: string,
  device: DeviceInfo,
): Promise<void> {
  await client.query(
    'INSERT INTO user_devices (id, user_id, device_id, platform, app_version, push_token)' +
      ' VALUES ($1,$2,$3,$4,$5,$6)' +
      ' ON CONFLICT (user_id, device_id) DO UPDATE' +
      '   SET last_seen_at = now(),' +
      '       app_version = COALESCE(EXCLUDED.app_version, user_devices.app_version),' +
      '       push_token = COALESCE(EXCLUDED.push_token, user_devices.push_token)',
    [
      uuidv7(),
      userId,
      device.deviceId,
      device.platform,
      device.appVersion ?? null,
      device.pushToken ?? null,
    ],
  );
}
