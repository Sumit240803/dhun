// Connectivity state.
//
// Matters more here than in most apps: the audience is largely tier-2 and tier-3
// India on patchy mobile data. "Nothing happened when I tapped" is almost always
// a dropped request, and telling the user that is the difference between a retry
// and an uninstall.
//
// `isInternetReachable` rather than `isConnected`: a phone attached to a Wi-Fi
// network with no upstream reports connected, which is exactly the captive-portal
// case that produces silent failures.

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';

export interface NetworkState {
  isOnline: boolean;
  /** wifi | cellular | none | unknown — used to hold back heavy prefetch on cellular. */
  type: string;
}

let state: NetworkState = { isOnline: true, type: 'unknown' };
const listeners = new Set<() => void>();

function apply(next: NetInfoState) {
  const isOnline = next.isConnected === true && next.isInternetReachable !== false;
  if (isOnline === state.isOnline && next.type === state.type) return;

  state = { isOnline, type: next.type };
  for (const listener of listeners) listener();
}

export function initNetworkMonitor(): () => void {
  return NetInfo.addEventListener(apply);
}

export function getNetworkState(): NetworkState {
  return state;
}

export function useNetwork(): NetworkState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getNetworkState,
    getNetworkState,
  );
}

/** True when a large prefetch should be deferred — gift animations are heavy. */
export function shouldDeferHeavyAssets(): boolean {
  return !state.isOnline || state.type === 'cellular';
}
