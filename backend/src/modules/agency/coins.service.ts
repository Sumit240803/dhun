// The agency coin channel: inventory in, coins out.
//
// Two flows, and the reason they are the whole point of M12 — at a ₹10,000
// floor, direct top-up is how AGENCIES buy stock, not how users buy coins.
// Almost every user's coins arrive through a transfer from one of these.
//
//   PREPAY  (§ C3) An admin records a payment received; a DIFFERENT admin
//           confirms it, and only the confirmation mints coins into the
//           agency's inventory. Never on credit (hard rule #3) — and never
//           by the agency itself.
//
//   TRANSFER (§ C4) The agency has already been paid by the user OFF-PLATFORM.
//           We move coins and nothing else. No escrow, no rupee leg, no route
//           back: inventory → user, and that is the only direction that exists
//           (hard rule #7).
//
// Both idempotency keys are derived from the record, never from a client
// header, for the same reason a purchase keys off its receipt: the record IS
// the money event, so one record can only ever be one credit however it is
// retried or raced.

import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import {
  ECONOMY,
  agencyTransferLegs,
  getBalance,
  getConfigValue,
  postTransaction,
  resellerPrepayLegs,
} from '../economy/index.js';
import { istDate } from '../rewards/index.js';
import { agentSeat } from './agency.service.js';

// ── Config ──────────────────────────────────────────────────────────────────

const capsSchema = z.object({
  perTransferMaxCoins: z.number().int().min(1),
  perRecipientDailyCoins: z.number().int().min(1),
  perAgencyDailyCoins: z.number().int().min(1),
  perAgencyDailyCount: z.number().int().min(1),
});

const channelSchema = z.object({
  minPrepayPaise: z.number().int().min(1),
  wholesaleTiers: z
    .array(z.object({ minPaise: z.number().int().min(0), coinsPerRupee: z.number().int().min(1) }))
    .min(1),
  transferCaps: capsSchema,
  newAgency: z.object({ days: z.number().int().min(0), transferCaps: capsSchema }),
});

export type TransferCaps = z.infer<typeof capsSchema>;
export type ChannelConfig = z.infer<typeof channelSchema>;

const DEFAULTS: ChannelConfig = {
  minPrepayPaise: 1_000_000,
  wholesaleTiers: [
    { minPaise: 1_000_000, coinsPerRupee: 124 },
    { minPaise: 5_000_000, coinsPerRupee: 132 },
    { minPaise: 20_000_000, coinsPerRupee: 140 },
  ],
  transferCaps: {
    perTransferMaxCoins: 1_100_000,
    perRecipientDailyCoins: 5_500_000,
    perAgencyDailyCoins: 22_000_000,
    perAgencyDailyCount: 500,
  },
  newAgency: {
    days: 30,
    transferCaps: {
      perTransferMaxCoins: 275_000,
      perRecipientDailyCoins: 1_100_000,
      perAgencyDailyCoins: 5_500_000,
      perAgencyDailyCount: 100,
    },
  },
};

export async function channelConfig(): Promise<ChannelConfig> {
  const parsed = channelSchema.safeParse(await getConfigValue('agency'));
  if (!parsed.success) {
    logger.error('app_config.agency channel fields are invalid; using defaults', {
      issues: parsed.error.issues.length,
    });
    return DEFAULTS;
  }
  return parsed.data;
}

/**
 * The wholesale rate for a given payment, from the volume tiers.
 *
 * The rate sets the payout ratio on these coins exactly as the pack rate does
 * on retail — `coins per ₹ ÷ 433.4` — so this is a margin dial, not a discount.
 */
export function rateFor(amountPaise: number, cfg: ChannelConfig): number {
  const tier = [...cfg.wholesaleTiers]
    .sort((a, b) => a.minPaise - b.minPaise)
    .filter((t) => amountPaise >= t.minPaise)
    .pop();
  if (!tier) throw new AppError('PREPAY_TOO_SMALL', 'That is below the minimum prepay', 422);
  return tier.coinsPerRupee;
}

/** Coins for rupees at a frozen rate. Floors, so we never over-issue on a remainder. */
export function coinsForPrepay(amountPaise: number, coinsPerRupee: number): number {
  return Math.floor((amountPaise * coinsPerRupee) / 100);
}

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface Prepay {
  id: string;
  agency: { id: string; publicId: number; name: string };
  amountPaise: number;
  coinsPerRupee: number;
  coins: number;
  method: 'bank_transfer' | 'upi' | 'gateway';
  paymentReference: string;
  status: 'pending' | 'confirmed' | 'rejected';
  recordedAt: string;
  decidedAt: string | null;
  rejectReason: string | null;
}

export interface Transfer {
  id: string;
  coins: number;
  note: string | null;
  createdAt: string;
  agency: { id: string; publicId: number; name: string };
  recipient: { userId: string; publicId: number; displayName: string | null };
}

export interface Inventory {
  agency: { id: string; publicId: number; name: string };
  coins: number;
  coinTradingEnabled: boolean;
  caps: TransferCaps;
  /** True while the agency is inside its opening window and on reduced caps. */
  isNewAgency: boolean;
  usedToday: { coins: number; count: number };
}

// ── Prepay ──────────────────────────────────────────────────────────────────

const PREPAY_SELECT = `
  SELECT p.id, p.amount_paise, p.coins_per_rupee, p.coins, p.method, p.payment_reference,
         p.status, p.recorded_at, p.decided_at, p.reject_reason,
         g.id AS agency_id, g.public_id AS agency_public_id, g.name AS agency_name
    FROM agency_prepays p JOIN agencies g ON g.id = p.agency_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPrepay(r: any): Prepay {
  return {
    id: r.id,
    agency: { id: r.agency_id, publicId: Number(r.agency_public_id), name: r.agency_name },
    amountPaise: Number(r.amount_paise),
    coinsPerRupee: r.coins_per_rupee,
    coins: Number(r.coins),
    method: r.method,
    paymentReference: r.payment_reference,
    status: r.status,
    recordedAt: r.recorded_at.toISOString(),
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    rejectReason: r.reject_reason,
  };
}

async function getPrepay(id: string): Promise<Prepay> {
  const { rows } = await pool.query(`${PREPAY_SELECT} WHERE p.id = $1`, [id]);
  if (!rows[0]) throw new AppError('PREPAY_NOT_FOUND', 'That prepay does not exist', 404);
  return toPrepay(rows[0]);
}

/**
 * The maker's half: record that money arrived. Mints nothing.
 *
 * The rate and the coin count are frozen here, so a tier retune between
 * recording and confirmation cannot change what the agency was quoted.
 */
export async function recordPrepay(
  adminUserId: string,
  input: {
    agencyPublicId: number;
    amountPaise: number;
    method: 'bank_transfer' | 'upi' | 'gateway';
    paymentReference: string;
  },
): Promise<Prepay> {
  const cfg = await channelConfig();
  if (input.amountPaise < cfg.minPrepayPaise) {
    throw new AppError('PREPAY_TOO_SMALL', 'That is below the minimum prepay', 422, {
      minPaise: cfg.minPrepayPaise,
    });
  }

  const { rows } = await pool.query(
    "SELECT id, coin_trading_enabled_at FROM agencies WHERE public_id = $1 AND status = 'active'",
    [input.agencyPublicId],
  );
  const agency = rows[0];
  if (!agency) throw new AppError('AGENCY_NOT_FOUND', 'No active agency has that Agency ID', 404);
  if (agency.coin_trading_enabled_at === null) {
    throw new AppError(
      'COIN_TRADING_DISABLED',
      'That agency is not approved for coin trading',
      409,
    );
  }

  const coinsPerRupee = rateFor(input.amountPaise, cfg);
  const id = uuidv7();
  try {
    await pool.query(
      `INSERT INTO agency_prepays
         (id, agency_id, amount_paise, coins_per_rupee, coins, method, payment_reference, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        agency.id,
        input.amountPaise,
        coinsPerRupee,
        coinsForPrepay(input.amountPaise, coinsPerRupee),
        input.method,
        input.paymentReference,
        adminUserId,
      ],
    );
  } catch (err) {
    // The (method, payment_reference) unique index: one bank credit is one
    // prepay, whoever types it in and however many times.
    if ((err as { code?: string }).code === '23505') {
      throw new AppError(
        'PREPAY_REFERENCE_USED',
        'That payment reference is already recorded',
        409,
      );
    }
    throw err;
  }
  return getPrepay(id);
}

/**
 * The checker's half: confirm the money is really there, and mint the coins.
 *
 * The database refuses a confirmation by the admin who recorded it, so
 * maker-checker is a constraint rather than a policy someone has to remember.
 */
export async function confirmPrepay(adminUserId: string, prepayId: string): Promise<Prepay> {
  const prepay = await getPrepay(prepayId);
  if (prepay.status !== 'pending') {
    throw new AppError('PREPAY_DECIDED', 'That prepay has already been decided', 409);
  }

  await postTransaction({
    txnType: 'reseller_prepay',
    // Derived from the prepay, never a client header: this record IS the money
    // event, so it can only ever mint once.
    idempotencyKey: `prepay:${prepay.id}`,
    identity: { prepay_id: prepay.id, agency_id: prepay.agency.id, coins: prepay.coins },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
    },
    legs: resellerPrepayLegs({
      agencyId: prepay.agency.id,
      coins: prepay.coins,
      cashPaise: prepay.amountPaise,
    }),
    actorUserId: adminUserId,
    memo: `prepay ${prepay.method} ${prepay.paymentReference}`,
    withinTransaction: async (client, txnId) => {
      // The trigger on agency_prepays allows only the decision to be written,
      // and only once — so a racing second confirmation updates no row and the
      // whole transaction, coins included, rolls back.
      const { rowCount } = await client.query(
        `UPDATE agency_prepays
            SET status = 'confirmed', decided_by = $2, decided_at = now(), ledger_txn_id = $3
          WHERE id = $1 AND status = 'pending'`,
        [prepay.id, adminUserId, txnId],
      );
      if (!rowCount) {
        throw new AppError('PREPAY_DECIDED', 'That prepay has already been decided', 409);
      }
    },
    events: [
      {
        eventType: 'agency_prepay_confirmed',
        partitionKey: prepay.agency.id,
        payload: {
          prepay_id: prepay.id,
          agency_id: prepay.agency.id,
          coins: prepay.coins,
          amount_paise: prepay.amountPaise,
          coins_per_rupee: prepay.coinsPerRupee,
        },
      },
    ],
  });

  return getPrepay(prepayId);
}

export async function rejectPrepay(
  adminUserId: string,
  prepayId: string,
  reason: string,
): Promise<Prepay> {
  const { rowCount } = await pool.query(
    `UPDATE agency_prepays
        SET status = 'rejected', decided_by = $2, decided_at = now(), reject_reason = $3
      WHERE id = $1 AND status = 'pending'`,
    [prepayId, adminUserId, reason],
  );
  if (!rowCount) {
    // Either it does not exist or it is already decided; getPrepay tells which.
    await getPrepay(prepayId);
    throw new AppError('PREPAY_DECIDED', 'That prepay has already been decided', 409);
  }
  return getPrepay(prepayId);
}

export async function listPrepays(filter: {
  status?: 'pending' | 'confirmed' | 'rejected';
  agencyId?: string;
  limit: number;
}): Promise<Prepay[]> {
  const { rows } = await pool.query(
    `${PREPAY_SELECT}
      WHERE ($1::text IS NULL OR p.status = $1)
        AND ($2::uuid IS NULL OR p.agency_id = $2)
      ORDER BY p.recorded_at DESC
      LIMIT $3`,
    [filter.status ?? null, filter.agencyId ?? null, filter.limit],
  );
  return rows.map(toPrepay);
}

// ── Inventory and caps ──────────────────────────────────────────────────────

/**
 * The agency the caller may trade for.
 *
 * Coin trading is granted separately from running an agency, because buying
 * inventory is where fraud and laundering land. Only the OWNER operates it: an
 * agent recruits hosts, and handing every agent the ability to move currency
 * would make the grant meaningless.
 */
async function tradingSeat(userId: string) {
  const seat = await agentSeat(userId);
  if (!seat?.isOwner) {
    throw new AppError('NOT_AGENCY_OWNER', 'Only the agency owner can move coins', 403);
  }
  const { rows } = await pool.query(
    'SELECT coin_trading_enabled_at, created_at FROM agencies WHERE id = $1',
    [seat.agency.id],
  );
  if (rows[0].coin_trading_enabled_at === null) {
    throw new AppError(
      'COIN_TRADING_DISABLED',
      'Your agency is not approved for coin trading',
      403,
    );
  }
  return { seat, createdAt: rows[0].created_at as Date };
}

/** Lower caps for an agency's first days — fraud clusters in the opening weeks. */
function capsFor(createdAt: Date, cfg: ChannelConfig): { caps: TransferCaps; isNew: boolean } {
  const isNew = createdAt.getTime() > Date.now() - cfg.newAgency.days * 86_400_000;
  return { caps: isNew ? cfg.newAgency.transferCaps : cfg.transferCaps, isNew };
}

/**
 * What the agency has moved today, in India.
 *
 * Counted per IST day rather than per UTC day, because a cap that resets at
 * 05:30 in the morning is not the cap anyone agreed to.
 */
async function usedToday(
  db: Pick<PoolClient, 'query'>,
  agencyId: string,
  recipientUserId?: string,
): Promise<{ coins: number; count: number; toRecipient: number }> {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(coins), 0) AS coins,
            COUNT(*) AS count,
            COALESCE(SUM(coins) FILTER (WHERE recipient_user_id = $3::uuid), 0) AS to_recipient
       FROM agency_transfers
      WHERE agency_id = $1
        AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date`,
    [agencyId, istDate(), recipientUserId ?? null],
  );
  return {
    coins: Number(rows[0].coins),
    count: Number(rows[0].count),
    toRecipient: Number(rows[0].to_recipient),
  };
}

export async function inventory(userId: string): Promise<Inventory> {
  const [{ seat, createdAt }, cfg] = await Promise.all([tradingSeat(userId), channelConfig()]);
  const { caps, isNew } = capsFor(createdAt, cfg);
  const [coins, used] = await Promise.all([
    getBalance('agency_inventory', seat.agency.id),
    usedToday(pool, seat.agency.id),
  ]);

  return {
    agency: { id: seat.agency.id, publicId: seat.agency.publicId, name: seat.agency.name },
    coins,
    coinTradingEnabled: true,
    caps,
    isNewAgency: isNew,
    usedToday: { coins: used.coins, count: used.count },
  };
}

// ── Transfer ────────────────────────────────────────────────────────────────

const TRANSFER_SELECT = `
  SELECT t.id, t.coins, t.note, t.created_at,
         g.id AS agency_id, g.public_id AS agency_public_id, g.name AS agency_name,
         t.recipient_user_id, u.public_id AS recipient_public_id, p.display_name AS recipient_name
    FROM agency_transfers t
    JOIN agencies g ON g.id = t.agency_id
    JOIN users u ON u.id = t.recipient_user_id
    LEFT JOIN user_profiles p ON p.user_id = t.recipient_user_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTransfer(r: any): Transfer {
  return {
    id: r.id,
    coins: Number(r.coins),
    note: r.note,
    createdAt: r.created_at.toISOString(),
    agency: { id: r.agency_id, publicId: Number(r.agency_public_id), name: r.agency_name },
    recipient: {
      userId: r.recipient_user_id,
      publicId: Number(r.recipient_public_id),
      displayName: r.recipient_name,
    },
  };
}

/**
 * Move coins from inventory to a user.
 *
 * `requestId` is generated once per transfer by the agency's client, so a retry
 * over a dropped connection cannot send the coins twice — and because it is
 * unique per agency in the database as well as in the ledger key, neither layer
 * can be the only thing holding that guarantee.
 */
export async function transfer(
  userId: string,
  input: { recipientPublicId: number; coins: number; requestId: string; note?: string },
): Promise<Transfer> {
  const [{ seat, createdAt }, cfg] = await Promise.all([tradingSeat(userId), channelConfig()]);
  const { caps } = capsFor(createdAt, cfg);

  if (input.coins > caps.perTransferMaxCoins) {
    throw new AppError('TRANSFER_TOO_LARGE', 'That is more than one transfer may carry', 422, {
      maxCoins: caps.perTransferMaxCoins,
    });
  }

  const { rows } = await pool.query(
    "SELECT id FROM users WHERE public_id = $1 AND status = 'active'",
    [input.recipientPublicId],
  );
  const recipient = rows[0];
  // Coins handed to an account that cannot spend them are a liability with no
  // purpose, and a banned or deleted account must not be topped up at all.
  if (!recipient) {
    throw new AppError('RECIPIENT_NOT_FOUND', 'No active account has that User ID', 404);
  }
  if (recipient.id === userId) {
    throw new AppError('TRANSFER_TO_SELF', 'You cannot transfer coins to yourself', 400);
  }

  const result = await postTransaction({
    txnType: 'purchase_reseller',
    idempotencyKey: `transfer:${seat.agency.id}:${input.requestId}`,
    identity: {
      agency_id: seat.agency.id,
      user_id: recipient.id,
      coins: input.coins,
      request_id: input.requestId,
    },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
    },
    legs: agencyTransferLegs({
      agencyId: seat.agency.id,
      userId: recipient.id,
      coins: input.coins,
    }),
    actorUserId: userId,
    response: (txnId) => ({ transferId: txnId }),
    withinTransaction: async (client, txnId) => {
      // Inside the ledger's transaction, like a gift's record: a transfer the
      // history shows can never be missing from the ledger, or the reverse.
      // The daily counts are read here too, under the same lock the balance
      // takes, so two simultaneous transfers cannot both pass the last cap.
      const used = await usedToday(client, seat.agency.id, recipient.id);
      if (used.count + 1 > caps.perAgencyDailyCount) {
        throw new AppError('TRANSFER_DAILY_LIMIT', 'This agency has reached its daily limit', 429, {
          maxCount: caps.perAgencyDailyCount,
        });
      }
      if (used.coins + input.coins > caps.perAgencyDailyCoins) {
        throw new AppError('TRANSFER_DAILY_LIMIT', 'This agency has reached its daily limit', 429, {
          maxCoins: caps.perAgencyDailyCoins,
        });
      }
      if (used.toRecipient + input.coins > caps.perRecipientDailyCoins) {
        throw new AppError(
          'RECIPIENT_DAILY_LIMIT',
          'That account has received its daily limit from this agency',
          429,
          { maxCoins: caps.perRecipientDailyCoins },
        );
      }

      await client.query(
        `INSERT INTO agency_transfers
           (id, agency_id, recipient_user_id, coins, sent_by_user_id, request_id, ledger_txn_id, note)
         VALUES ($1, $2, $3, $4, $5, $6, $1, $7)`,
        [
          txnId,
          seat.agency.id,
          recipient.id,
          input.coins,
          userId,
          input.requestId,
          input.note ?? null,
        ],
      );
    },
    events: [
      {
        eventType: 'agency_coins_transferred',
        partitionKey: seat.agency.id,
        payload: {
          agency_id: seat.agency.id,
          recipient_id: recipient.id,
          coins: input.coins,
          sent_by: userId,
        },
      },
    ],
  });

  const { rows: saved } = await pool.query(`${TRANSFER_SELECT} WHERE t.id = $1`, [result.txnId]);
  return toTransfer(saved[0]);
}

/** What the agency has sent. */
export async function agencyTransfers(userId: string, limit: number): Promise<Transfer[]> {
  const { seat } = await tradingSeat(userId);
  const { rows } = await pool.query(
    `${TRANSFER_SELECT} WHERE t.agency_id = $1 ORDER BY t.created_at DESC LIMIT $2`,
    [seat.agency.id, limit],
  );
  return rows.map(toTransfer);
}

/** What the user has received — their side of the same permanent record. */
export async function receivedTransfers(userId: string, limit: number): Promise<Transfer[]> {
  const { rows } = await pool.query(
    `${TRANSFER_SELECT} WHERE t.recipient_user_id = $1 ORDER BY t.created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toTransfer);
}

/** Admin: the coins an agency is holding right now. */
export async function agencyInventoryCoins(agencyId: string): Promise<number> {
  return getBalance('agency_inventory', agencyId);
}
