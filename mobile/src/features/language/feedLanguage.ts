// Which language the feeds are narrowed to. One choice for both feed tabs —
// someone who picked Bhojpuri on Live expects Party to show Bhojpuri too.
//
// Null means every language, and it is the default: at launch a feed filtered
// to one language is an empty feed. Remembered on the device, never on the
// server — it is a view setting, not something about the person.

import { useSyncExternalStore } from 'react';

import type { Language } from '@/api/types';
import { preferences } from '@/lib/preferences';

import { isLanguage } from './languages';

const KEY = 'feed.language';

let current: Language | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export const feedLanguage = {
  get: (): Language | null => current,

  set(next: Language | null) {
    current = next;
    emit();
    void preferences.set(KEY, next ?? 'all');
  },

  /** Reads the saved choice once. A value that is no longer offered reads as all. */
  async load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const saved = await preferences.get(KEY);
    if (isLanguage(saved)) {
      current = saved;
      emit();
    }
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useFeedLanguage(): Language | null {
  return useSyncExternalStore(feedLanguage.subscribe, feedLanguage.get, feedLanguage.get);
}
