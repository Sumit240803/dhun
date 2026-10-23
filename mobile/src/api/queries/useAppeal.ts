import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { appealsApi } from '@/api/endpoints/appeals';
import { queryKeys } from '@/api/queries/keys';
import { track } from '@/lib/analytics';

/** Whether this account can go live, and where its appeal stands if not. */
export function useMyAppeal(enabled = true) {
  return useQuery({
    queryKey: queryKeys.appeals.me(),
    queryFn: async () => (await appealsApi.me()).appeal,
    enabled,
    // A decision lands when a lead gets to it. Half a minute is enough to
    // keep the go-live door and the Me card honest.
    staleTime: 30_000,
  });
}

export function useFileAppeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: appealsApi.file,
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.appeals.me(), result.appeal);
      track('appeal_filed');
    },
  });
}
