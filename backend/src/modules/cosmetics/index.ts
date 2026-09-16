// PUBLIC API of the cosmetics module.
//
// Buying, owning and wearing avatar frames, chat bubbles, nickname colours and
// entry effects — and `looksFor`, which every place that draws a person uses to
// draw them as they chose to appear. Money moves through economy's ledger; this
// module never writes a balance.

export { buildCosmeticsRouter } from './cosmetics.routes.js';

export {
  equipCosmetic,
  listOwned,
  purchaseCosmetic,
  unequipKind,
} from './cosmetics.service.js';
export type { CosmeticPurchaseResult, OwnedCosmetic } from './cosmetics.service.js';

export { clearLookCache, invalidateLook, lookFor, looksFor } from './looks.js';
export { EMPTY_LOOK, type UserLook } from '../../shared/cosmeticStyle.js';
