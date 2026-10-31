// VIP tiers: four monthly bundles, priced in gems.
//
// A tier is a `cosmetics` row of kind `vip` — the price and the 30 days live
// there, with every other item — plus a config entry naming the badge, the
// perks the app lists, and the cosmetics bundled for the same period. Owning
// one is a `user_cosmetics` row like a frame's, so the look reader, the expiry
// rule and the "mine" list all work unchanged; the bundled items are rows of
// their own with source = 'vip'.
//
// Zero points. VIP pays no host, so it uses the cosmetic legs (gems → float,
// deferred revenue → cosmetics revenue) under the `vip_purchase` type, which
// the switch for the store covers. Renewal is another purchase, stacking
// time (ledger-decisions § C12).

import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import {
  ECONOMY,
  cosmeticPurchaseLegs,
  getConfigValue,
  getCosmeticForSale,
  postTransaction,
} from '../economy/index.js';
import { invalidateLook } from './looks.js';

export const VIP_BADGES = ['silver', 'gold', 'platinum', 'diamond'] as const;
export type VipBadge = (typeof VIP_BADGES)[number];

const PERKS = [
  'badge',
  'name_color',
  'bubble',
  'entry',
  'frame',
  'stealth',
  'global_badge',
  'priority_mic',
] as const;
export type VipPerk = (typeof PERKS)[number];

const tiersSchema = z
  .object({
    tiers: z
      .array(
        z
          .object({
            id: z.string().regex(/^vip_[a-z]+$/),
            badge: z.enum(VIP_BADGES),
            includes: z.array(z.string().min(1).max(64)).max(8),
            perks: z.array(z.enum(PERKS)).max(PERKS.length),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();

type TierSpec = z.infer<typeof tiersSchema>['tiers'][number];

export interface VipTier extends TierSpec {
  name: string;
  gemPrice: number;
  durationDays: number;
}

async function tierSpecs(): Promise<TierSpec[]> {
  const parsed = tiersSchema.safeParse(await getConfigValue('vip_tiers'));
  if (!parsed.success) {
    logger.error('app_config.vip_tiers is invalid; no tiers offered', { issues: parsed.error.issues.length });
    return [];
  }
  return parsed.data.tiers;
}

/** Tiers on sale: in config AND active in the catalog, in catalog order. */
export async function listVipTiers(): Promise<VipTier[]> {
  const [specs, { rows }] = await Promise.all([
    tierSpecs(),
    pool.query<{ id: string; name: string; gem_price: string; duration_days: number | null }>(
      `SELECT id, name, gem_price, duration_days
         FROM cosmetics
        WHERE kind = 'vip' AND is_active
          AND (visible_from IS NULL OR visible_from <= now())
          AND (visible_to IS NULL OR visible_to > now())
        ORDER BY sort_order`,
    ),
  ]);
  const tiers: VipTier[] = [];
  for (const row of rows) {
    if (row.duration_days === null) continue;
    const spec = specs.find((s) => s.id === row.id);
    if (!spec) continue;
    tiers.push({ ...spec, name: row.name, gemPrice: Number(row.gem_price), durationDays: row.duration_days });
  }
  return tiers;
}

export interface VipPurchaseResult {
  tierId: string;
  badge: VipBadge;
  gemsSpent: number;
  expiresAt: string;
  replayed: boolean;
}

export async function purchaseVip(input: {
  userId: string;
  tierId: string;
  expectedGemPrice: number;
  idempotencyKey: string;
}): Promise<VipPurchaseResult> {
  const tier = (await listVipTiers()).find((t) => t.id === input.tierId);
  if (!tier) throw new AppError('COSMETIC_NOT_FOUND', 'That tier is not available', 404);
  // Uncached, like every purchase: a withdrawn or repriced tier stops selling at once.
  const item = await getCosmeticForSale(tier.id);
  if (item.gemPrice !== input.expectedGemPrice) {
    throw new AppError('COSMETIC_PRICE_CHANGED', 'The price of this tier has changed', 409, {
      gemPrice: item.gemPrice,
    });
  }
  const days = tier.durationDays;
  let expiresAt = '';

  const result = await postTransaction({
    txnType: 'vip_purchase',
    idempotencyKey: input.idempotencyKey,
    identity: { item_id: tier.id, duration_days: days },
    rates: { faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee, pointsPerRupee: ECONOMY.pointsPerRupee },
    actorUserId: input.userId,
    legs: cosmeticPurchaseLegs({ userId: input.userId, gems: item.gemPrice }),
    withinTransaction: async (client, txnId) => {
      // One tier worn at a time: a Gold buyer who was Silver is now Gold.
      await client.query(
        `UPDATE user_cosmetics SET equipped = false
          WHERE user_id = $1 AND kind = 'vip' AND cosmetic_id <> $2 AND equipped`,
        [input.userId, tier.id],
      );
      const { rows } = await client.query<{ expires_at: Date }>(
        `INSERT INTO user_cosmetics (user_id, cosmetic_id, kind, expires_at, equipped, source)
              VALUES ($1, $2, 'vip', now() + make_interval(days => $3), true, 'purchase')
         ON CONFLICT (user_id, cosmetic_id) DO UPDATE
            SET expires_at = GREATEST(user_cosmetics.expires_at, now()) + make_interval(days => $3),
                equipped = true
         RETURNING expires_at`,
        [input.userId, tier.id, days],
      );
      expiresAt = rows[0].expires_at.toISOString();

      await client.query(
        `INSERT INTO cosmetic_purchases (txn_id, user_id, cosmetic_id, gems, duration_days, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [txnId, input.userId, tier.id, item.gemPrice, days, rows[0].expires_at],
      );

      // The bundle, for the same period. Time stacks onto an item already
      // rented; an item earned by level (NULL expiry) is left exactly as it
      // is. Equipped only when nothing of that kind is on — the bundle must
      // not take off something the person chose to wear.
      for (const cosmeticId of tier.includes) {
        await client.query(
          `INSERT INTO user_cosmetics (user_id, cosmetic_id, kind, expires_at, equipped, source)
           SELECT $1, c.id, c.kind, now() + make_interval(days => $3),
                  NOT EXISTS (SELECT 1 FROM user_cosmetics w
                               WHERE w.user_id = $1 AND w.kind = c.kind AND w.equipped
                                 AND (w.expires_at IS NULL OR w.expires_at > now())),
                  'vip'
             FROM cosmetics c
            WHERE c.id = $2 AND c.kind <> 'vip'
           ON CONFLICT (user_id, cosmetic_id) DO UPDATE
              SET expires_at = CASE
                    WHEN user_cosmetics.expires_at IS NULL THEN NULL
                    ELSE GREATEST(user_cosmetics.expires_at, now()) + make_interval(days => $3)
                  END`,
          [input.userId, cosmeticId, days],
        );
      }
    },
    events: [
      {
        eventType: 'vip_purchased',
        partitionKey: input.userId,
        payload: { user_id: input.userId, tier_id: tier.id, gems: item.gemPrice, duration_days: days },
      },
    ],
    response: () => ({ tierId: tier.id, badge: tier.badge, gemsSpent: item.gemPrice, expiresAt }),
  });

  if (!result.replayed) {
    invalidateLook(input.userId);
    logger.info('vip purchased', { txn_id: result.txnId, tier_id: tier.id, gems: item.gemPrice });
  }
  const stored = result.response as Partial<Omit<VipPurchaseResult, 'replayed'>>;
  if (!stored.tierId || !stored.expiresAt) {
    throw new AppError('PURCHASE_ALREADY_APPLIED', 'This purchase was already made', 409);
  }
  return {
    tierId: stored.tierId,
    badge: stored.badge ?? tier.badge,
    gemsSpent: Number(stored.gemsSpent ?? item.gemPrice),
    expiresAt: stored.expiresAt,
    replayed: result.replayed,
  };
}
