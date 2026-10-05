import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { agencyApi } from '@/api/endpoints/agency';
import { queryKeys } from '@/api/queries/keys';

export function useMyAgency(enabled = true) {
  return useQuery({ queryKey: queryKeys.agency.me(), queryFn: agencyApi.me, enabled });
}

export function useHostCode(enabled = true) {
  return useQuery({
    queryKey: queryKeys.agency.hostCode(),
    queryFn: agencyApi.hostCode,
    enabled,
    staleTime: Infinity,
  });
}

export function useJoinRequests(enabled = true) {
  return useQuery({ queryKey: queryKeys.agency.requests(), queryFn: agencyApi.requests, enabled });
}

/** Owner only: anyone else is refused with NOT_AGENCY_OWNER. */
export function useQuitRequests(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.agency.quitRequests(),
    queryFn: async () => (await agencyApi.quitRequests()).requests,
    enabled,
  });
}

/** Any membership change can touch every agency view, so all of them refetch. */
function useAgencyMutation<A, R>(fn: (arg: A) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.agency.all }),
  });
}

export function useInventory(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.agency.inventory(),
    queryFn: agencyApi.inventory,
    enabled,
    // Stock and the day's usage both move with every transfer.
    staleTime: 10_000,
  });
}

export function useAgencyTransfers(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.agency.transfers(),
    queryFn: async () => (await agencyApi.transfers()).transfers,
    enabled,
  });
}

export function useReceivedCoins(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.agency.received(),
    queryFn: async () => (await agencyApi.received()).transfers,
    enabled,
  });
}

export const useJoinAgent = () => useAgencyMutation(agencyApi.join);
export const useInviteHost = () =>
  useAgencyMutation((v: { userId: number; hostCode: string }) =>
    agencyApi.invite(v.userId, v.hostCode),
  );
export const useRotateHostCode = () => useAgencyMutation(() => agencyApi.rotateHostCode());
export const useAnswerRequest = () =>
  useAgencyMutation((v: { id: string; accept: boolean }) =>
    v.accept ? agencyApi.accept(v.id) : agencyApi.decline(v.id),
  );
export const useCancelRequest = () => useAgencyMutation(agencyApi.cancel);
export const useQuitAgency = () => useAgencyMutation(agencyApi.quit);
/** A transfer moves coins, so the wallet is stale as well as the agency views. */
export function useTransferCoins() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: agencyApi.transfer,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agency.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.wallet.all });
    },
  });
}

export const useDecideQuit = () =>
  useAgencyMutation((v: { id: string; approve: boolean }) =>
    v.approve ? agencyApi.approveQuit(v.id) : agencyApi.rejectQuit(v.id),
  );
