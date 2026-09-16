import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { giftsApi } from '@/api/endpoints/gifts';
import { queryKeys } from '@/api/queries/keys';
import type { Wallet } from '@/api/types';
import { track } from '@/lib/analytics';

/**
 * Sends one gift.
 *
 * The balance in the response is written straight into the wallet cache. A
 * combo is a thumb tapping several times a second, and a balance that lags a
 * refetch behind would show coins the user has already spent.
 */
export function useSendGift(roomId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: giftsApi.send,
    onSuccess: (result) => {
      queryClient.setQueryData<Wallet>(queryKeys.wallet.balance(), (wallet) =>
        wallet ? { ...wallet, coins: result.balance.coins } : wallet,
      );
      // The transaction list moved too, but nobody is looking at it mid-room.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.wallet.transactions(),
        refetchType: 'none',
      });
      if (roomId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.leaderboard(roomId) });
      }

      track('gift_sent', {
        gift_id: result.gift.giftId,
        tier: result.gift.tier,
        quantity: result.gift.quantity,
        coins: result.coinsSpent,
        room_id: roomId,
        replayed: result.replayed,
      });
    },
  });
}

/**
 * Who has given the most in this room.
 *
 * Polled only while someone is looking at it. A board refreshing in the
 * background of every viewer in a busy room is a request every few seconds for
 * a screen nobody has open.
 */
export function useRoomLeaderboard(roomId: string | undefined, open: boolean) {
  return useQuery({
    queryKey: queryKeys.rooms.leaderboard(roomId ?? ''),
    queryFn: async () => (await giftsApi.leaderboard(roomId!)).leaderboard,
    enabled: roomId !== undefined && open,
    refetchInterval: open ? 5_000 : false,
    staleTime: 2_000,
  });
}
