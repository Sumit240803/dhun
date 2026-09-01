// Remote configuration, applied at launch.
//
// Day-1 non-negotiable #5: force-update plus a remote kill switch per major
// feature. `applyRemoteFlags` has existed in config/flags.ts since the
// foundation with nothing to feed it; this is what feeds it.

import { useQuery } from '@tanstack/react-query';
import * as Application from 'expo-application';
import { useEffect } from 'react';

import { configApi } from '@/api/endpoints/feed';
import { queryKeys } from '@/api/queries/keys';
import { applyRemoteFlags, type Flags } from '@/config/flags';
import { isOlderThan } from '@/lib/version';

export type UpdateState = 'none' | 'available' | 'required';

/**
 * Fetches config, applies the flags, and reports whether an update is needed.
 *
 * Fails OPEN. If the config endpoint is unreachable the app runs on its local
 * defaults — the alternative is that an outage of a non-critical endpoint
 * bricks every install, which is a far worse failure than a stale flag.
 */
export function useAppConfig(): { update: UpdateState; storeUrl: string } {
  const query = useQuery({
    queryKey: queryKeys.config.app(),
    queryFn: async () => (await configApi.app()).config,
    staleTime: 5 * 60_000,
    // One retry, then give up and let the app start. A launch must never wait
    // on this.
    retry: 1,
  });

  const config = query.data;

  useEffect(() => {
    if (config) applyRemoteFlags(config.flags as Partial<Flags>);
  }, [config]);

  if (!config) return { update: 'none', storeUrl: '' };

  const version = Application.nativeApplicationVersion ?? '0.0.0';

  return {
    update: isOlderThan(version, config.minSupportedVersion)
      ? 'required'
      : isOlderThan(version, config.latestVersion)
        ? 'available'
        : 'none',
    storeUrl: config.storeUrl,
  };
}
