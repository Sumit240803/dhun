// Owning and wearing cosmetics. The catalog itself is `catalogApi.cosmetics`.

import { api } from '@/api/client';
import type { CosmeticKind, CosmeticPurchaseResult, OwnedCosmetic } from '@/api/types';

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
};
