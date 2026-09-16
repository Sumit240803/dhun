// Small, non-secret, per-device memory: "already shown today", "already done once".
//
// Kept on SecureStore because it is already a dependency and these values are
// tiny — not because they are secrets. Every read FAILS SOFT: a flag that cannot
// be read is treated as unset, which at worst shows a prompt twice. It must
// never stop the app from starting.

import * as SecureStore from 'expo-secure-store';

const PREFIX = 'pref.';

export const preferences = {
  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(PREFIX + key);
    } catch {
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(PREFIX + key, value);
    } catch {
      // Forgetting a "seen" flag costs one repeated prompt. Not worth an error.
    }
  },
};

/** The IST calendar date, YYYY-MM-DD — the day rewards and prompts turn over on. */
export function istDate(now: number = Date.now()): string {
  return new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
