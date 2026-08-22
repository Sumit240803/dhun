// Query keys, centralised.
//
// Scattered inline keys are how an invalidation silently misses a screen: a
// purchase updates the wallet tab but the room's balance chip keeps showing the
// old number, and nobody notices until a user tries to send a gift they can no
// longer afford.
//
// Hierarchical by design — invalidating `wallet.all` clears the balance, the
// transaction list and the purchase history in one call.

export const queryKeys = {
  session: ['session'] as const,

  wallet: {
    all: ['wallet'] as const,
    balance: () => [...queryKeys.wallet.all, 'balance'] as const,
    packs: () => [...queryKeys.wallet.all, 'packs'] as const,
    transactions: () => [...queryKeys.wallet.all, 'transactions'] as const,
    purchases: () => [...queryKeys.wallet.all, 'purchases'] as const,
  },

  catalog: {
    all: ['catalog'] as const,
    gifts: () => [...queryKeys.catalog.all, 'gifts'] as const,
    cosmetics: () => [...queryKeys.catalog.all, 'cosmetics'] as const,
  },

  rooms: {
    all: ['rooms'] as const,
    feed: () => [...queryKeys.rooms.all, 'feed'] as const,
    detail: (roomId: string) => [...queryKeys.rooms.all, 'detail', roomId] as const,
  },
} as const;
