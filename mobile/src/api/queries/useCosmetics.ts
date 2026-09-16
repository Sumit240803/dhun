import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cosmeticsApi } from '@/api/endpoints/cosmetics';
import { catalogApi } from '@/api/endpoints/wallet';
import { queryKeys } from '@/api/queries/keys';
import type { OwnedCosmetic, Wallet } from '@/api/types';
import { track } from '@/lib/analytics';

/** The store's shelves, and the live coins→gems terms that travel with them. */
export function useCosmeticCatalog() {
  return useQuery({
    queryKey: queryKeys.catalog.cosmetics(),
    queryFn: () => catalogApi.cosmetics(),
    staleTime: 10 * 60_000,
  });
}

export function useMyCosmetics(enabled = true) {
  return useQuery({
    queryKey: queryKeys.cosmetics.mine(),
    queryFn: async () => (await cosmeticsApi.mine()).items,
    enabled,
    // Expiry is evaluated by the server on every read; a short stale time keeps
    // a lapsed item from still reading "equipped" for long.
    staleTime: 30_000,
  });
}

/**
 * Everything a look change touches.
 *
 * The profile summary carries the owner's own look, and every room and profile
 * query carries other people's — but those belong to OTHER people, and the
 * server refreshes them within seconds. Only the owner's own views are
 * invalidated here.
 */
function refreshOwnLook(queryClient: ReturnType<typeof useQueryClient>, items: OwnedCosmetic[]) {
  queryClient.setQueryData(queryKeys.cosmetics.mine(), items);
  void queryClient.invalidateQueries({ queryKey: queryKeys.profile.summary() });
}

export function usePurchaseCosmetic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cosmeticsApi.purchase,
    onSuccess: (result) => {
      queryClient.setQueryData<Wallet>(queryKeys.wallet.balance(), (wallet) =>
        wallet ? { ...wallet, gems: result.balance.gems } : wallet,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.cosmetics.mine() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile.summary() });

      track('cosmetic_purchased', {
        cosmetic_id: result.item.cosmeticId,
        kind: result.item.kind,
        gems: result.gemsSpent,
        replayed: result.replayed,
      });
    },
  });
}

export function useEquipCosmetic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cosmeticsApi.equip,
    onSuccess: (result) => refreshOwnLook(queryClient, result.items),
  });
}

export function useUnequipCosmetic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cosmeticsApi.unequip,
    onSuccess: (result) => refreshOwnLook(queryClient, result.items),
  });
}
