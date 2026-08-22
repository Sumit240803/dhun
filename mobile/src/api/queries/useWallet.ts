// WORKED EXAMPLE for `api/queries/`: a hook per resource, keys from keys.ts,
// invalidation that cannot miss a screen.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { walletApi } from '@/api/endpoints/wallet';
import { queryKeys } from '@/api/queries/keys';
import { track } from '@/lib/analytics';

export function useWallet() {
  return useQuery({
    queryKey: queryKeys.wallet.balance(),
    queryFn: async () => (await walletApi.get()).wallet,
    // A balance is shown next to a spend button. Thirty seconds of staleness is
    // fine for display; the server is authoritative at the moment of spending
    // and will reject an overdraft regardless of what the client believed.
    staleTime: 30_000,
  });
}

export function useCoinPacks() {
  return useQuery({
    queryKey: queryKeys.wallet.packs(),
    queryFn: async () => (await walletApi.packs()).packs,
    // Server-driven config that changes rarely. Long stale time so opening the
    // buy sheet is instant — it is the moment money gets spent.
    staleTime: 10 * 60_000,
  });
}

export function useConvertCoins() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: walletApi.convert,
    onSuccess: (result) => {
      track('coins_converted', {
        gems_received: result.gemsReceived,
        replayed: result.replayed,
      });
      // Invalidate the whole wallet branch, not just the balance: coins, gems
      // and the transaction list all moved.
      void queryClient.invalidateQueries({ queryKey: queryKeys.wallet.all });
    },
  });
}
