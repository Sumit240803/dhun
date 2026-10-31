// Gifting endpoints.
//
// The idempotency key comes from the CALLER, generated once per tap and reused
// if that same tap has to be retried. See features/gifting/sendIntent.ts for
// when a key is reused and when a fresh one is minted.

import { api } from '@/api/client';
import type {
  FanLevel,
  GiftQuantity,
  HostEarnings,
  LeaderboardEntry,
  SendGiftResult,
} from '@/api/types';

export const giftsApi = {
  /** Your fan level with one host. A reading of gifts already sent; nothing is paid on it. */
  fanLevel: (hostId: string) => api.get<{ fan: FanLevel }>(`gifts/fan-level/${hostId}`),

  send: (input: {
    roomId: string;
    recipientId: string;
    giftId: string;
    quantity: GiftQuantity;
    /** The unit price the sheet displayed. A repriced gift is refused, never charged. */
    expectedCoinPrice: number;
    idempotencyKey: string;
  }) =>
    api.post<SendGiftResult>(
      'gifts/send',
      {
        roomId: input.roomId,
        recipientId: input.recipientId,
        giftId: input.giftId,
        quantity: input.quantity,
        expectedCoinPrice: input.expectedCoinPrice,
      },
      { idempotencyKey: input.idempotencyKey },
    ),

  leaderboard: (roomId: string) =>
    api.get<{ leaderboard: LeaderboardEntry[] }>(`gifts/leaderboard/${roomId}`),
  /** The caller's own earnings, as a host. */
  earnings: () => api.get<{ earnings: HostEarnings }>('gifts/earnings'),
};
