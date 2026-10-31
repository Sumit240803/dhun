// Owning and wearing cosmetics. The catalog itself is `catalogApi.cosmetics`.

import { api } from '@/api/client';
import type {
  CosmeticKind,
  CosmeticPurchaseResult,
  OwnedCosmetic,
  SuperMessageTerms,
  SuperView,
  VipPurchaseResult,
  VipTier,
} from '@/api/types';

export const cosmeticsApi = {
  mine: () => api.get<{ items: OwnedCosmetic[] }>('cosmetics/mine'),

  purchase: (input: { cosmeticId: string; expectedGemPrice: number; idempotencyKey: string }) =>
    api.post<CosmeticPurchaseResult>(
      'cosmetics/purchase',
      { cosmeticId: input.cosmeticId, expectedGemPrice: input.expectedGemPrice },
      { idempotencyKey: input.idempotencyKey },
    ),

  equip: (cosmeticId: string) =>
    api.post<{ items: OwnedCosmetic[] }>('cosmetics/equip', { cosmeticId }),

  unequip: (kind: CosmeticKind) =>
    api.post<{ items: OwnedCosmetic[] }>('cosmetics/unequip', { kind }),

  /** A super message is a cosmetic for a sentence: gems, zero host payout. */
  superTerms: () => api.get<{ super: SuperMessageTerms }>('cosmetics/super'),
  sendSuper: (input: {
    roomId: string;
    body: string;
    expectedGemPrice: number;
    idempotencyKey: string;
  }) =>
    api.post<{ message: SuperView; replayed: boolean }>(
      'cosmetics/super',
      { roomId: input.roomId, body: input.body, expectedGemPrice: input.expectedGemPrice },
      { idempotencyKey: input.idempotencyKey },
    ),

  vipTiers: () => api.get<{ tiers: VipTier[] }>('cosmetics/vip'),
  purchaseVip: (input: { tierId: string; expectedGemPrice: number; idempotencyKey: string }) =>
    api.post<VipPurchaseResult>(
      'cosmetics/vip/purchase',
      { tierId: input.tierId, expectedGemPrice: input.expectedGemPrice },
      { idempotencyKey: input.idempotencyKey },
    ),
};
