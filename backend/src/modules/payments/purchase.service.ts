// Coin pack purchases.
//
// THE RECEIPT IS THE IDEMPOTENCY IDENTITY. One receipt means one credit, forever.
// Both guards below derive from that, and it is the client's header that is the
// weaker of the two:
//
//   1. UNIQUE (provider, provider_txn_id) on purchases — one row per receipt.
//   2. The ledger key is derived from `provider:provider_txn_id`, NOT from the
//      client's Idempotency-Key — one credit per receipt.
//
// Guard 2 exists because guard 1 alone is not enough: replaying a captured
// receipt under a fresh idempotency key would be blocked from inserting a second
// purchases ROW while the ledger still moved the money. Receipt replay is a known
// fraud route in mobile games, so this path is tested explicitly.
//
// The purchases row is written BEFORE the ledger transaction, deliberately. A
// crash between the two leaves a 'pending' row and no credit; retrying completes
// it without double-crediting, because the ledger is idempotent on the same
// derived key. Safe to resume, and visible to reconciliation.

import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import {
  getCoinPack,
  levelFor,
  postTransaction,
  purchaseLegs,
  type PurchaseChannel,
} from '../economy/index.js';
import { ECONOMY } from '../economy/rates.js';
import { iapVerifier, verifyRazorpaySignature, type VerificationResult } from './verifiers.js';

export interface PurchaseResult {
  purchaseId: string;
  txnId: string;
  replayed: boolean;
  coinsGranted: number;
  gemsGranted: number;
  balances: { coins: number; gems: number };
  userLevel: number;
}

async function assertLifetimeOnceNotUsed(userId: string, packId: string): Promise<void> {
  const { rows } = await pool.query(
    "SELECT 1 FROM purchases WHERE user_id = $1 AND pack_id = $2 AND status = 'credited' LIMIT 1",
    [userId, packId],
  );
  if (rows.length) {
    throw new AppError('PACK_ALREADY_PURCHASED', 'This pack can only be bought once', 409, {
      packId,
    });
  }
}

async function creditPurchase(input: {
  userId: string;
  packId: string;
  channel: PurchaseChannel;
  provider: string;
  verification: VerificationResult;
  idempotencyKey: string;
}): Promise<PurchaseResult> {
  const pack = await getCoinPack(input.packId);
  if (pack.lifetimeOnce) await assertLifetimeOnceNotUsed(input.userId, input.packId);

  // What the provider charged wins over what our catalog says, if it tells us.
  // A mismatch means the client asked for one pack and paid for another.
  const amountPaise = input.verification.amountPaise ?? pack.pricePaise;
  if (input.verification.amountPaise && input.verification.amountPaise !== pack.pricePaise) {
    throw new AppError('AMOUNT_MISMATCH', 'Amount paid does not match the pack price', 402, {
      expected: pack.pricePaise,
      paid: input.verification.amountPaise,
    });
  }

  const purchaseId = uuidv7();
  let existingPurchaseId: string | undefined;

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; status: string; user_id: string }>(
      'INSERT INTO purchases' +
        ' (id, user_id, pack_id, channel, provider, provider_txn_id, amount_paise,' +
        '  coins_granted, gems_granted, raw_receipt)' +
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)' +
        ' ON CONFLICT (provider, provider_txn_id) DO NOTHING' +
        ' RETURNING id, status, user_id',
      [
        purchaseId,
        input.userId,
        pack.id,
        input.channel,
        input.provider,
        input.verification.providerTxnId,
        amountPaise,
        pack.coins,
        pack.gems,
        JSON.stringify(input.verification.raw ?? {}),
      ],
    );

    if (!rows[0]) {
      const { rows: prior } = await client.query<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM purchases WHERE provider = $1 AND provider_txn_id = $2',
        [input.provider, input.verification.providerTxnId],
      );
      // Someone is presenting a receipt that has already been used. If it is not
      // even the same user, that is an attack, not a retry.
      if (prior[0] && prior[0].user_id !== input.userId) {
        logger.warn('receipt replay across accounts', {
          provider: input.provider,
          provider_txn_id: input.verification.providerTxnId,
        });
        throw new AppError('RECEIPT_ALREADY_USED', 'This receipt has already been redeemed', 409);
      }
      existingPurchaseId = prior[0]?.id;
    }
  });

  const effectivePurchaseId = existingPurchaseId ?? purchaseId;

  // The ledger key is derived from the RECEIPT, not from the client's header.
  //
  // A receipt is the money event: one receipt must mean one credit, forever. If
  // the ledger keyed off the client's Idempotency-Key instead, replaying a
  // captured receipt under a fresh key would create a second ledger transaction
  // and credit the coins twice — the purchases UNIQUE constraint would stop the
  // duplicate ROW while the money still moved.
  //
  // The client header is still required (it is the API convention, and the app
  // needs it for its own retry logic), but it is not what makes this safe.
  const ledgerKey = `purchase:${input.provider}:${input.verification.providerTxnId}`;

  const result = await postTransaction({
    txnType: input.channel === 'iap' ? 'purchase_iap' : 'purchase_web',
    idempotencyKey: ledgerKey,
    identity: {
      pack_id: pack.id,
      provider: input.provider,
      provider_txn_id: input.verification.providerTxnId,
    },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
    },
    actorUserId: input.userId,
    legs: purchaseLegs({
      userId: input.userId,
      coins: pack.coins,
      gems: pack.gems,
      cashPaise: amountPaise,
      channel: input.channel,
    }),
    events: [
      {
        eventType: 'purchase_completed',
        partitionKey: input.userId,
        payload: {
          user_id: input.userId,
          pack_id: pack.id,
          channel: input.channel,
          amount_paise: amountPaise,
          coins: pack.coins,
          gems: pack.gems,
        },
      },
    ],
    response: { purchase_id: effectivePurchaseId, coins: pack.coins, gems: pack.gems },
  });

  // Level accrues on PURCHASE, not on spend — free coins are ordinary coins now,
  // so scoring on spend would let daily check-ins be ground into levels.
  const stats = await withTransaction(async (client) => {
    await client.query(
      "UPDATE purchases SET status = 'credited', credited_at = now(), ledger_txn_id = $2" +
        " WHERE id = $1 AND status <> 'credited'",
      [effectivePurchaseId, result.txnId],
    );

    const { rows } = await client.query<{
      lifetime_purchased_coins: string;
      lifetime_spend_paise: string;
    }>(
      'INSERT INTO user_stats (user_id, lifetime_purchased_coins, lifetime_spend_paise, first_purchase_at)' +
        ' VALUES ($1,$2,$3, now())' +
        ' ON CONFLICT (user_id) DO UPDATE SET' +
        '   lifetime_purchased_coins = user_stats.lifetime_purchased_coins + EXCLUDED.lifetime_purchased_coins,' +
        '   lifetime_spend_paise = user_stats.lifetime_spend_paise + EXCLUDED.lifetime_spend_paise,' +
        '   updated_at = now()' +
        ' RETURNING lifetime_purchased_coins, lifetime_spend_paise',
      // A replay must not inflate the counters a second time.
      [input.userId, result.replayed ? 0 : pack.coins, result.replayed ? 0 : amountPaise],
    );
    return { purchased: Number(rows[0].lifetime_purchased_coins) };
  });

  const userLevel = await levelFor('user', stats.purchased);
  await pool.query('UPDATE user_stats SET user_level = $2 WHERE user_id = $1', [
    input.userId,
    userLevel,
  ]);

  const { getBalance } = await import('../economy/index.js');
  const [coins, gems] = await Promise.all([
    getBalance('user_coins', input.userId),
    getBalance('user_gems', input.userId),
  ]);

  return {
    purchaseId: effectivePurchaseId,
    txnId: result.txnId,
    replayed: result.replayed,
    coinsGranted: pack.coins,
    gemsGranted: pack.gems,
    balances: { coins, gems },
    userLevel,
  };
}

export async function purchaseViaIap(input: {
  userId: string;
  packId: string;
  purchaseToken: string;
  idempotencyKey: string;
}): Promise<PurchaseResult> {
  const pack = await getCoinPack(input.packId);
  const verification = await iapVerifier.verify({
    productId: pack.playProductId ?? pack.id,
    purchaseToken: input.purchaseToken,
  });

  return creditPurchase({
    userId: input.userId,
    packId: input.packId,
    channel: 'iap',
    provider: iapVerifier.provider,
    verification,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function purchaseViaWeb(input: {
  userId: string;
  packId: string;
  orderId: string;
  paymentId: string;
  signature: string;
  idempotencyKey: string;
}): Promise<PurchaseResult> {
  const verification = verifyRazorpaySignature({
    orderId: input.orderId,
    paymentId: input.paymentId,
    signature: input.signature,
  });

  return creditPurchase({
    userId: input.userId,
    packId: input.packId,
    channel: 'web',
    provider: 'razorpay',
    verification,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function listPurchases(userId: string, limit = 50) {
  const { rows } = await pool.query(
    'SELECT id, pack_id, channel, amount_paise, coins_granted, gems_granted, status, created_at' +
      ' FROM purchases WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    packId: r.pack_id,
    channel: r.channel,
    amountPaise: Number(r.amount_paise),
    coins: Number(r.coins_granted),
    gems: Number(r.gems_granted),
    status: r.status,
    createdAt: r.created_at,
  }));
}
