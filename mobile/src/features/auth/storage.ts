// Token storage.
//
// expo-secure-store, never AsyncStorage: this is Keychain on iOS and
// EncryptedSharedPreferences on Android, so a rooted-device dump or a filesystem
// backup does not hand over a live session.

import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN = 'auth.accessToken';
const REFRESH_TOKEN = 'auth.refreshToken';
const DEVICE_ID = 'device.id';

const options: SecureStore.SecureStoreOptions = {
  // Available after first unlock, but never migrated to a new device — a
  // restored backup must not carry a live session onto someone else's phone.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, options);
  } catch {
    // A corrupted keychain entry must not brick the app on launch; treat it as
    // "no session" and let the user sign in again.
    return null;
  }
}

async function write(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await SecureStore.deleteItemAsync(key, options).catch(() => undefined);
    return;
  }
  await SecureStore.setItemAsync(key, value, options);
}

export const tokenStorage = {
  getAccess: () => read(ACCESS_TOKEN),
  getRefresh: () => read(REFRESH_TOKEN),

  async save(tokens: { accessToken: string; refreshToken: string }): Promise<void> {
    await Promise.all([
      write(ACCESS_TOKEN, tokens.accessToken),
      write(REFRESH_TOKEN, tokens.refreshToken),
    ]);
  },

  async clear(): Promise<void> {
    await Promise.all([write(ACCESS_TOKEN, null), write(REFRESH_TOKEN, null)]);
  },
};

export const deviceStorage = {
  get: () => read(DEVICE_ID),
  set: (id: string) => write(DEVICE_ID, id),
};
