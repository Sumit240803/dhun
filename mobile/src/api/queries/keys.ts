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
    // Keyed by category so switching tabs does not discard the other tab's
    // pages — coming back to Explore should be instant, not another spinner.
    feed: (category: string) => [...queryKeys.rooms.all, 'feed', category] as const,
    detail: (roomId: string) => [...queryKeys.rooms.all, 'detail', roomId] as const,
  },

  messages: {
    all: ['messages'] as const,
    threads: (filter: string) => [...queryKeys.messages.all, 'threads', filter] as const,
    thread: (threadId: string) => [...queryKeys.messages.all, 'thread', threadId] as const,
  },

  profile: {
    all: ['profile'] as const,
    summary: () => [...queryKeys.profile.all, 'summary'] as const,
  },

  config: {
    all: ['config'] as const,
    banners: () => [...queryKeys.config.all, 'banners'] as const,
  },
} as const;
