// Buying, owning and wearing cosmetics.
//
// A purchase is the zero-payout path the margin design rests on: gems out,
// revenue_cosmetics in, no host leg at all (economy's `cosmeticPurchaseLegs`).
// What this file adds is ownership — which rows change, and how time stacks.
//
// Rules, from ledger-decisions § C11c/C11d:
//   · every purchase is one transaction at full price;
//   · time is added to the CURRENT expiry while an item is still active, so an
//     early extension never throws away days already paid for;
//   · buying equips — you bought it to wear it;
//   · one equipped item per kind, enforced by a unique index;
//   · expiry is read, never swept.

import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError, IdempotencyKeyReusedError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { isWearable, WEARABLE_KINDS, type WearableKind } from '../../shared/cosmeticStyle.js';
import {
  cosmeticPurchaseLegs,
  ECONOMY,
  findTransactionByKey,
  getBalance,
  getCosmeticForSale,
  postTransaction,
} from '../economy/index.js';
import { invalidateLook } from './looks.js';

export interface OwnedCosmetic {
  cosmeticId: string;
  kind: string;
  name: string;
  expiresAt: string;
  /** Still within its time. An expired item stays listed so it can be renewed. */
  active: boolean;
  equipped: boolean;
}

export interface CosmeticPurchaseResult {
  item: OwnedCosmetic;
  gemsSpent: number;
  balance: { gems: number };
  replayed: boolean;
}

export async function purchaseCosmetic(input: {
  userId: string;
  cosmeticId: string;
  /** The gem price the store displayed. */
  expectedGemPrice: number;
  idempotencyKey: string;
}): Promise<CosmeticPurchaseResult> {
  // Identity per ledger-decisions § B2. The duration is not known until the
  // catalog row is read, so a replay is looked up by key first and its identity
  // is checked against what that key originally bought.
  const cosmetic = await getCosmeticForSaleOrReplay(input);
  if ('replayed' in cosmetic) return cosmetic;

  if (!isWearable(cosmetic.kind) || cosmetic.durationDays === null) {
    // VIP and super message are catalogued but not sold yet.
    throw new AppError('COSMETIC_NOT_FOUND', 'That item is not available', 404);
  }
  if (cosmetic.gemPrice !== input.expectedGemPrice) {
    throw new AppError('COSMETIC_PRICE_CHANGED', 'The price of this item has changed', 409, {
      gemPrice: cosmetic.gemPrice,
    });
  }

  const durationDays = cosmetic.durationDays;
  let expiresAt = '';

  const result = await postTransaction({
    txnType: 'cosmetic_purchase',
    idempotencyKey: input.idempotencyKey,
    identity: { item_id: cosmetic.id, duration_days: durationDays },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
    },
    actorUserId: input.userId,
    legs: cosmeticPurchaseLegs({ userId: input.userId, gems: cosmetic.gemPrice }),
    withinTransaction: async (client, txnId) => {
      expiresAt = await grantTime(client, {
        txnId,
        userId: input.userId,
        cosmeticId: cosmetic.id,
        kind: cosmetic.kind as WearableKind,
        gems: cosmetic.gemPrice,
        durationDays,
      });
    },
    events: [
      {
        eventType: 'cosmetic_purchased',
        partitionKey: input.userId,
        payload: {
          user_id: input.userId,
          cosmetic_id: cosmetic.id,
          kind: cosmetic.kind,
          gems: cosmetic.gemPrice,
          duration_days: durationDays,
        },
      },
    ],
    response: () => ({ cosmeticId: cosmetic.id, gemsSpent: cosmetic.gemPrice, expiresAt }),
  });

  if (!result.replayed) {
    invalidateLook(input.userId);
    logger.info('cosmetic purchased', {
      txn_id: result.txnId,
      cosmetic_id: cosmetic.id,
      gems: cosmetic.gemPrice,
    });
  }

  return withOwnership(result.response, input.userId, result.replayed);
}

/**
 * Replay first, for the same reason as gifting: a purchase whose response was
 * lost must come back as the purchase it was, even if the item has since been
 * withdrawn or repriced.
 */
async function getCosmeticForSaleOrReplay(input: {
  userId: string;
  cosmeticId: string;
  idempotencyKey: string;
}) {
  const prior = await findTransactionByKey(input.idempotencyKey, 'cosmetic_purchase');
  // Someone else's key is never replayed back to a different account — that
  // would describe their purchase to a stranger.
  if (prior && prior.actorUserId !== input.userId) {
    throw new IdempotencyKeyReusedError(input.idempotencyKey);
  }
  if (prior && prior.identity.item_id === input.cosmeticId) {
    return withOwnership(prior.result.response, input.userId, true);
  }
  // A key used for a DIFFERENT item falls through, and postTransaction refuses
  // it as a reused key.
  return getCosmeticForSale(input.cosmeticId);
}

/**
 * Adds the time and equips the item, inside the ledger's transaction.
 *
 * The user's gem account row is already locked by `postTransaction` by the
 * time this runs, so two purchases by the same person cannot interleave here.
 */
async function grantTime(
  client: PoolClient,
  row: {
    txnId: string;
    userId: string;
    cosmeticId: string;
    kind: WearableKind;
    gems: number;
    durationDays: number;
  },
): Promise<string> {
  // Whatever else of this kind was being worn comes off first, or the unique
  // index refuses the equip below.
  await client.query(
    `UPDATE user_cosmetics SET equipped = false
      WHERE user_id = $1 AND kind = $2 AND cosmetic_id <> $3 AND equipped`,
    [row.userId, row.kind, row.cosmeticId],
  );

  const { rows } = await client.query<{ expires_at: Date }>(
    `INSERT INTO user_cosmetics (user_id, cosmetic_id, kind, expires_at, equipped)
          VALUES ($1, $2, $3, now() + make_interval(days => $4), true)
     ON CONFLICT (user_id, cosmetic_id) DO UPDATE
        SET expires_at = GREATEST(user_cosmetics.expires_at, now()) + make_interval(days => $4),
            equipped = true
     RETURNING expires_at`,
    [row.userId, row.cosmeticId, row.kind, row.durationDays],
  );
  const expiresAt = rows[0].expires_at;

  await client.query(
    `INSERT INTO cosmetic_purchases (txn_id, user_id, cosmetic_id, gems, duration_days, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.txnId, row.userId, row.cosmeticId, row.gems, row.durationDays, expiresAt],
  );

  return expiresAt.toISOString();
}

async function withOwnership(
  response: Record<string, unknown>,
  userId: string,
  replayed: boolean,
): Promise<CosmeticPurchaseResult> {
  const stored = response as { cosmeticId?: string; gemsSpent?: number };
  if (!stored.cosmeticId) {
    // A replay after the 7-day response purge. Honest rather than a crash.
    throw new AppError('PURCHASE_ALREADY_APPLIED', 'This purchase was already made', 409);
  }

  const owned = (await listOwned(userId)).find((item) => item.cosmeticId === stored.cosmeticId);
  if (!owned) {
    // Cannot happen: the ownership row is written in the purchase's own
    // transaction. Loud, because if it ever does, someone paid for nothing.
    logger.error('purchased cosmetic has no ownership row', {
      user_id: userId,
      cosmetic_id: stored.cosmeticId,
    });
    throw new AppError('INTERNAL_ERROR', 'Something went wrong', 500);
  }

  return {
    item: owned,
    gemsSpent: stored.gemsSpent ?? 0,
    balance: { gems: await getBalance('user_gems', userId) },
    replayed,
  };
}

/** Everything a user holds, active or lapsed, newest expiry first. */
export async function listOwned(userId: string): Promise<OwnedCosmetic[]> {
  const { rows } = await pool.query<{
    cosmetic_id: string;
    kind: string;
    name: string;
    expires_at: Date;
    active: boolean;
    equipped: boolean;
  }>(
    `SELECT uc.cosmetic_id, uc.kind, c.name, uc.expires_at,
            uc.expires_at > now() AS active, uc.equipped
       FROM user_cosmetics uc
       JOIN cosmetics c ON c.id = uc.cosmetic_id
      WHERE uc.user_id = $1
      ORDER BY uc.expires_at DESC`,
    [userId],
  );

  return rows.map((r) => ({
    cosmeticId: r.cosmetic_id,
    kind: r.kind,
    name: r.name,
    expiresAt: r.expires_at.toISOString(),
    active: r.active,
    // An expired item may still carry the flag — it simply draws nothing. It
    // is reported as not equipped, which is what the user actually sees.
    equipped: r.equipped && r.active,
  }));
}

/** Wears something already owned and still active. */
export async function equipCosmetic(userId: string, cosmeticId: string): Promise<OwnedCosmetic[]> {
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ kind: string; active: boolean }>(
      `SELECT kind, expires_at > now() AS active FROM user_cosmetics
        WHERE user_id = $1 AND cosmetic_id = $2
        FOR UPDATE`,
      [userId, cosmeticId],
    );
    const owned = rows[0];
    if (!owned) throw new AppError('COSMETIC_NOT_OWNED', 'You do not own that item', 404);
    if (!owned.active) {
      throw new AppError('COSMETIC_EXPIRED', 'That item has expired. Renew it to wear it.', 410);
    }

    await client.query(
      `UPDATE user_cosmetics SET equipped = false
        WHERE user_id = $1 AND kind = $2 AND cosmetic_id <> $3 AND equipped`,
      [userId, owned.kind, cosmeticId],
    );
    await client.query(
      'UPDATE user_cosmetics SET equipped = true WHERE user_id = $1 AND cosmetic_id = $2',
      [userId, cosmeticId],
    );
  });

  invalidateLook(userId);
  return listOwned(userId);
}

/** Takes off whatever of this kind is being worn. Taking off nothing is fine. */
export async function unequipKind(userId: string, kind: WearableKind): Promise<OwnedCosmetic[]> {
  if (!WEARABLE_KINDS.includes(kind)) {
    throw new AppError('VALIDATION_FAILED', 'Unknown cosmetic kind', 422);
  }
  await pool.query(
    'UPDATE user_cosmetics SET equipped = false WHERE user_id = $1 AND kind = $2 AND equipped',
    [userId, kind],
  );
  invalidateLook(userId);
  return listOwned(userId);
}
