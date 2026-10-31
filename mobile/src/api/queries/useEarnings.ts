import { useQuery } from '@tanstack/react-query';

import { giftsApi } from '@/api/endpoints/gifts';
import { queryKeys } from '@/api/queries/keys';

/** The host's own earnings. Read from gifts already sent; a minute of staleness is nothing. */
export function useHostEarnings() {
  return useQuery({
    queryKey: queryKeys.gifts.earnings(),
    queryFn: async () => (await giftsApi.earnings()).earnings,
    staleTime: 60_000,
  });
}
