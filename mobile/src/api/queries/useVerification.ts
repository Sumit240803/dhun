import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { verificationApi } from '@/api/endpoints/verification';
import { queryKeys } from '@/api/queries/keys';
import { track } from '@/lib/analytics';

export function useMyVerification(enabled = true) {
  return useQuery({
    queryKey: queryKeys.verification.me(),
    queryFn: async () => (await verificationApi.me()).verification,
    enabled,
    // A review lands when a moderator gets to it, not on a schedule. Half a
    // minute keeps the Me row honest without polling the server for nothing.
    staleTime: 30_000,
  });
}

export function useSubmitVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: verificationApi.submit,
    onSuccess: () => {
      // The Me row and the profile badge both read this.
      void queryClient.invalidateQueries({ queryKey: queryKeys.verification.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
      track('verification_submitted');
    },
  });
}
