// PUBLIC API of the economy module. Other modules import ONLY from here.
//
// economy is the SOLE writer of ledger_* and account_balances. Nothing else
// touches them — every other module moves money by calling postTransaction()
// with an idempotency key and a set of balanced legs.

export { postTransaction, getBalance } from './ledger.service.js';

export { buildWalletRouter } from './wallet.routes.js';
export { buildCatalogRouter } from './catalog.routes.js';

export { getWallet, convertCoinsToGems, listTransactions, recomputeUserLevel } from './wallet.service.js';
export type { Wallet, WalletTransaction } from './wallet.service.js';

export {
  listCoinPacks,
  getCoinPack,
  listGifts,
  getGift,
  listCosmetics,
  getConfigNumber,
  levelFor,
  invalidateCatalogCache,
} from './catalog.service.js';
export type { CoinPack, Gift, Cosmetic } from './catalog.service.js';

export {
  purchaseLegs,
  giftLegs,
  cosmeticPurchaseLegs,
  conversionLegs,
  freeCoinGrantLegs,
} from './flows.js';
export type { PurchaseChannel } from './flows.js';

export { ECONOMY, unitsToPaise, pointsToPaise, giftPoints, coinsToGems } from './rates.js';

export type {
  Leg,
  OutboxEvent,
  FrozenRates,
  PostTxnInput,
  PostTxnResult,
} from './ledger.types.js';

export { SCOPED_ACCOUNTS } from './accounts.js';
export type { ScopedAccountCode } from './accounts.js';
