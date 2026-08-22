// Asset resolution, caching and preloading.
//
// Every visual in this app is SERVER-DRIVEN: the catalog returns a path like
// `gifts/yacht.json` and the client resolves it against a CDN base. Day-1
// non-negotiable #6 — adding a gift must never require an app release.
//
// The preloading rule matters commercially: assets are fetched when the CATALOG
// loads, not when the gift sheet opens. The sheet is the moment money is spent,
// and a spinner there costs a purchase.

import { Image } from 'expo-image';

import { env } from '@/config/env';
import { shouldDeferHeavyAssets } from '@/lib/network';
import { reportMessage } from '@/lib/reporting';

/**
 * Where assets live.
 *
 * Falls back to the API origin so a development build works without a separate
 * CDN, but production should point at CloudFront — gift animations are the
 * heaviest thing this app downloads and they want an Indian edge.
 */
const ASSET_BASE = (process.env.EXPO_PUBLIC_ASSET_URL ?? env.apiUrl).replace(/\/+$/, '');

/** Absolute URL for a catalog asset path. Already-absolute URLs pass through. */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${ASSET_BASE}/${path.replace(/^\/+/, '')}`;
}

/**
 * Lottie JSON, fetched and cached in memory.
 *
 * Assets are IMMUTABLE per id — a gift's animation never changes in place, it
 * gets a new id — so a cache entry never needs invalidating. That is what makes
 * caching this aggressively safe.
 */
const lottieCache = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown | null>>();

export async function loadLottie(path: string | null): Promise<unknown | null> {
  const url = assetUrl(path);
  if (!url) return null;

  const cached = lottieCache.get(url);
  if (cached) return cached;

  // Deduplicate: a room where six people send the same gift at once must fetch
  // it once, not six times.
  const existing = inFlight.get(url);
  if (existing) return existing;

  const request = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      lottieCache.set(url, json);
      return json;
    } catch (error) {
      // Never throw. A missing animation degrades to a static image and then to
      // text — it must not take down the room.
      reportMessage('lottie asset failed to load', {
        code: 'ASSET_LOAD_FAILED',
        url,
        error: String(error),
      });
      return null;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, request);
  return request;
}

/**
 * Warms the cache after the catalog loads.
 *
 * Cheap tiers first: a Rose is sent constantly and is tiny, while a Galaxy is
 * rare and heavy. On cellular, only the low tiers are prefetched — this audience
 * is largely on metered tier-2 data, and silently burning it on animations they
 * may never see is a way to get uninstalled.
 */
export async function preloadGiftAssets(
  gifts: { tier: number; animationAsset: string | null }[],
): Promise<void> {
  const deferHeavy = shouldDeferHeavyAssets();

  const targets = gifts
    .filter((gift) => gift.animationAsset)
    .filter((gift) => !deferHeavy || gift.tier <= 2)
    .sort((a, b) => a.tier - b.tier)
    .slice(0, 24);

  // Sequential on purpose: parallel fetches of twenty animations on a weak
  // connection starve the requests that matter, like joining a room.
  for (const gift of targets) {
    await loadLottie(gift.animationAsset);
  }
}

/** Static imagery — frames, covers, avatars. expo-image handles disk caching. */
export function preloadImages(paths: (string | null | undefined)[]): void {
  const urls = paths.map(assetUrl).filter((url): url is string => url !== null);
  if (urls.length) void Image.prefetch(urls);
}

/** Test seam, and used when a user clears storage from settings. */
export function clearAssetCache(): void {
  lottieCache.clear();
  inFlight.clear();
}
