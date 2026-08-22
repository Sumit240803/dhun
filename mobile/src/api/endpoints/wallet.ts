// Wallet and catalog endpoints.
//
// Every money call takes an `idempotencyKey` from the CALLER. Generated once
// when the user taps and reused for every retry — a key made per request is
// useless, because each retry would then look like a new purchase.

import { api } from '@/api/client';
import type {
  CoinPack,
  Cosmetic,
  Gift,
  PurchaseResult,
  Wallet,
  WalletTransaction,
} from '@/api/types';

export const walletApi = {
  get: () => api.get<{ wallet: Wallet }>('wallet'),
  packs: () => api.get<{ packs: CoinPack[] }>('wallet/packs'),

  transactions: (params: { limit?: number; before?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.before) query.set('before', params.before);
    const suffix = query.toString();
    return api.get<{ transactions: WalletTransaction[] }>(
      `wallet/transactions${suffix ? `?${suffix}` : ''}`,
    );
  },

  purchaseIap: (input: { packId: string; purchaseToken: string; idempotencyKey: string }) =>
    api.post<PurchaseResult>(
      'wallet/purchase/iap',
      { packId: input.packId, purchaseToken: input.purchaseToken },
      { idempotencyKey: input.idempotencyKey },
    ),

  convert: (input: { coins: number; idempotencyKey: string }) =>
    api.post<{ txnId: string; replayed: boolean; gemsReceived: number; wallet: Wallet }>(
      'wallet/convert',
      { coins: input.coins },
      { idempotencyKey: input.idempotencyKey },
    ),
};

export const catalogApi = {
  gifts: () => api.get<{ gifts: Gift[] }>('catalog/gifts'),
  cosmetics: () => api.get<{ cosmetics: Cosmetic[] }>('catalog/cosmetics'),
};
