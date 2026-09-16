import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { discoverApi, rewardsApi } from '@/api/endpoints/growth';
import { queryKeys } from '@/api/queries/keys';
import { track } from '@/lib/analytics';

export function useRewards(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rewards.status(),
    queryFn: async () => (await rewardsApi.status()).rewards,
    enabled,
    // Check-in state turns over at midnight IST; a minute of staleness is fine,
    // an hour would offer yesterday's claim.
    staleTime: 60_000,
  });
}

/** A claim moved coins: the balance and the reward state both changed. */
function afterClaim(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.rewards.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.wallet.all });
}

export function useClaimWelcome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rewardsApi.claimWelcome,
    onSuccess: (result) => {
      afterClaim(queryClient);
      if (!result.alreadyClaimed)
        track('free_coins_earned', { source: 'signup', coins: result.coins });
    },
  });
}

export function useCheckin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rewardsApi.checkin,
    onSuccess: (result) => {
      afterClaim(queryClient);
      if (!result.alreadyClaimed) {
        track('free_coins_earned', {
          source: 'daily_checkin',
          coins: result.coins,
          streak_day: result.streakDay,
        });
      }
    },
  });
}

export function useEnterReferralCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rewardsApi.enterCode,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.rewards.all }),
  });
}

/**
 * Search, for a query that has already been debounced by the caller.
 *
 * Keyed on the query, so going back to an earlier one is instant, and older
 * in-flight searches are cancelled by React Query's abort signal rather than
 * landing after a newer one and overwriting it.
 */
export function useSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: queryKeys.discover.search(trimmed),
    queryFn: ({ signal }) => discoverApi.search(trimmed, signal),
    enabled: trimmed.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}
