// Wallet reads and the coins → gems conversion.

import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { getConfigNumber, levelFor } from './catalog.service.js';
import { conversionLegs } from './flows.js';
import { getBalance, postTransaction } from './ledger.service.js';
import { coinsToGems, ECONOMY } from './rates.js';

export interface Wallet {
  coins: number;
  gems: number;
  userLevel: number;
  lifetimePurchasedCoins: number;
}

export async function getWallet(userId: string): Promise<Wallet> {
  const [coins, gems, stats] = await Promise.all([
    getBalance('user_coins', userId),
    getBalance('user_gems', userId),
    pool.query<{ lifetime_purchased_coins: string; user_level: number }>(
      'SELECT lifetime_purchased_coins, user_level FROM user_stats WHERE user_id = $1',
      [userId],
    ),
  ]);

  return {
    coins,
    gems,
    userLevel: stats.rows[0]?.user_level ?? 1,
    lifetimePurchasedCoins: Number(stats.rows[0]?.lifetime_purchased_coins ?? 0),
  };
}

/**
 * Converts coins into gems, one way, at the configured bonus.
 *
 * This is the lever that pulls the blended payout ratio down: coins pay hosts
 * 30% of face value, gems pay nothing. Converting is worth enough to the platform
 * that a generous bonus still comes out ahead — which is why the rate lives in
 * app_config rather than in code.
 *
 * There is deliberately no reverse. Gems converting back to coins would let a
 * whale turn cosmetics money into giftable coins and the payout design collapses.
 */
export async function convertCoinsToGems(input: {
  userId: string;
  coins: number;
  idempotencyKey: string;
}): Promise<{ txnId: string; replayed: boolean; gemsReceived: number; wallet: Wallet }> {
  const minimum = await getConfigNumber('min_conversion_coins', 100);
  if (input.coins < minimum) {
    throw new AppError('CONVERSION_TOO_SMALL', `Convert at least ${minimum} coins`, 422, {
      minimum,
    });
  }

  const rateBp = await getConfigNumber('coin_to_gem_rate_bp', ECONOMY.coinToGemRateBp);
  const gemsReceived = coinsToGems(input.coins, rateBp);

  const result = await postTransaction({
    txnType: 'coin_to_gem_conversion',
    idempotencyKey: input.idempotencyKey,
    identity: { coin_amount: input.coins },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
      coinToGemRateBp: rateBp,
    },
    actorUserId: input.userId,
    legs: conversionLegs({ userId: input.userId, coins: input.coins, rateBp }),
    events: [
      {
        eventType: 'coins_converted',
        partitionKey: input.userId,
        payload: { user_id: input.userId, coins: input.coins, gems: gemsReceived, rate_bp: rateBp },
      },
    ],
    response: { coins_spent: input.coins, gems_received: gemsReceived },
  });

  return {
    txnId: result.txnId,
    replayed: result.replayed,
    gemsReceived,
    wallet: await getWallet(input.userId),
  };
}

export interface WalletTransaction {
  id: string;
  type: string;
  createdAt: Date;
  coins: number;
  gems: number;
  points: number;
}

/**
 * A user's own transaction history, read from the ledger.
 *
 * Only their scoped accounts are joined, so a user can never see a system
 * account or another person's movements.
 */
export async function listTransactions(
  userId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<WalletTransaction[]> {
  const limit = Math.min(opts.limit ?? 50, 200);

  const { rows } = await pool.query(
    'SELECT t.id, t.txn_type, t.created_at,' +
      "  COALESCE(SUM(e.amount) FILTER (WHERE a.code = 'user_coins'), 0) AS coins," +
      "  COALESCE(SUM(e.amount) FILTER (WHERE a.code = 'user_gems'), 0) AS gems," +
      "  COALESCE(SUM(e.amount) FILTER (WHERE a.code LIKE 'host_points%'), 0) AS points" +
      ' FROM ledger_txns t' +
      ' JOIN ledger_entries e ON e.txn_id = t.id' +
      ' JOIN ledger_accounts a ON a.id = e.account_id' +
      ' WHERE a.scope_id = $1' +
      ' AND ($2::uuid IS NULL OR t.id < $2::uuid)' +
      ' GROUP BY t.id, t.txn_type, t.created_at' +
      ' ORDER BY t.id DESC LIMIT $3',
    [userId, opts.before ?? null, limit],
  );

  return rows.map((r) => ({
    id: r.id,
    type: r.txn_type,
    createdAt: r.created_at,
    coins: Number(r.coins),
    gems: Number(r.gems),
    points: Number(r.points),
  }));
}

export async function recomputeUserLevel(userId: string): Promise<number> {
  const { rows } = await pool.query<{ lifetime_purchased_coins: string }>(
    'SELECT lifetime_purchased_coins FROM user_stats WHERE user_id = $1',
    [userId],
  );
  const level = await levelFor('user', Number(rows[0]?.lifetime_purchased_coins ?? 0));
  await pool.query(
    'INSERT INTO user_stats (user_id, user_level) VALUES ($1,$2)' +
      ' ON CONFLICT (user_id) DO UPDATE SET user_level = EXCLUDED.user_level',
    [userId, level],
  );
  return level;
}
