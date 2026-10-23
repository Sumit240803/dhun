// Editing the catalog and the dials from the admin panel.
//
// Day-1 non-negotiable #6: adding a gift or changing a price must never need an
// app release. Until now it needed a psql session, which is one step better.
// Every write here lands in `config_changes` with who and why, and clears the
// catalog cache so the next request sees it.
//
// Two things are NOT editable here on purpose:
//
//   · A gift's id and tier. The id is a foreign key from every gift_sends row
//     ever written; the tier decides the effect the client plays. New gifts are
//     a migration, as the Scooter and Candy/Balloon were.
//   · Payout rate on gifts ALREADY SENT. `gift_sends` records the points at
//     the moment of sending, so a rate change here reprices nothing in the past
//     — which is the property the whole ledger depends on.

import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { freeCoinsSchema, newUserRewardsSchema } from '../../shared/rewardsConfig.js';
import { getConfigValue, invalidateCatalogCache } from '../economy/index.js';
import { coldStartSchema } from './appConfig.service.js';
import { cleanReason } from './features.js';

// ── Gifts ───────────────────────────────────────────────────────────────────

export interface AdminGift {
  id: string;
  name: string;
  tier: number;
  coinPrice: number;
  payoutRateBp: number;
  effect: string;
  isActive: boolean;
  sortOrder: number;
}

export async function adminGifts(): Promise<AdminGift[]> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    tier: number;
    coin_price: string;
    payout_rate_bp: number;
    effect: string;
    is_active: boolean;
    sort_order: number;
  }>(
    `SELECT id, name, tier, coin_price, payout_rate_bp, effect, is_active, sort_order
       FROM gift_catalog ORDER BY tier, sort_order, id`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tier: r.tier,
    coinPrice: Number(r.coin_price),
    payoutRateBp: r.payout_rate_bp,
    effect: r.effect,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  }));
}

const giftEdit = z.object({
  coinPrice: z.number().int().min(1).max(10_000_000),
  // Per gift, never a global constant (day-1 non-negotiable #12). 60% is the
  // advertised base; the panel can hand a single gift 70% for an event.
  payoutRateBp: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
});

export async function updateGift(input: {
  id: string;
  coinPrice: number;
  payoutRateBp: number;
  isActive: boolean;
  actorId: string;
  reason: string;
}): Promise<void> {
  const reason = cleanReason(input.reason);
  const next = parseOrThrow(giftEdit, input);

  await withTransaction(async (client) => {
    const { rows } = await client.query<{
      coin_price: string;
      payout_rate_bp: number;
      is_active: boolean;
    }>('SELECT coin_price, payout_rate_bp, is_active FROM gift_catalog WHERE id = $1 FOR UPDATE', [
      input.id,
    ]);
    if (!rows[0]) throw new AppError('GIFT_NOT_FOUND', 'That gift does not exist', 404);
    const before = {
      coinPrice: Number(rows[0].coin_price),
      payoutRateBp: rows[0].payout_rate_bp,
      isActive: rows[0].is_active,
    };
    if (sameValue(before, next)) throw new AppError('NO_CHANGE', 'Nothing changed', 422);

    await client.query(
      'UPDATE gift_catalog SET coin_price = $2, payout_rate_bp = $3, is_active = $4 WHERE id = $1',
      [input.id, next.coinPrice, next.payoutRateBp, next.isActive],
    );
    await recordChange(client, `gift.${input.id}`, before, next, reason, input.actorId);
  });

  invalidateCatalogCache();
  logger.warn('gift edited', { gift_id: input.id, ...next, actor_id: input.actorId, reason });
}

// ── Packs ───────────────────────────────────────────────────────────────────

export interface AdminPack {
  id: string;
  name: string;
  pricePaise: number;
  coins: number;
  gems: number;
  badge: string | null;
  lifetimeOnce: boolean;
  isActive: boolean;
  playProductId: string | null;
}

export async function adminPacks(): Promise<AdminPack[]> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    price_paise: string;
    coins: string;
    gems: string;
    badge: string | null;
    lifetime_once: boolean;
    is_active: boolean;
    play_product_id: string | null;
  }>(
    `SELECT id, name, price_paise, coins, gems, badge, lifetime_once, is_active, play_product_id
       FROM coin_packs ORDER BY sort_order, id`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    pricePaise: Number(r.price_paise),
    coins: Number(r.coins),
    gems: Number(r.gems),
    badge: r.badge,
    lifetimeOnce: r.lifetime_once,
    isActive: r.is_active,
    playProductId: r.play_product_id,
  }));
}

const packEdit = z
  .object({
    // ₹1 to ₹1,00,000. The Play price is set in the Play Console and must be
    // moved by hand to match; this is what the app shows and what web charges.
    pricePaise: z.number().int().min(100).max(10_000_000),
    coins: z.number().int().min(0).max(100_000_000),
    gems: z.number().int().min(0).max(100_000_000),
    isActive: z.boolean(),
  })
  .refine((p) => p.coins + p.gems > 0, { message: 'A pack must give something' });

export async function updatePack(input: {
  id: string;
  pricePaise: number;
  coins: number;
  gems: number;
  isActive: boolean;
  actorId: string;
  reason: string;
}): Promise<void> {
  const reason = cleanReason(input.reason);
  const next = parseOrThrow(packEdit, input);

  await withTransaction(async (client) => {
    const { rows } = await client.query<{
      price_paise: string;
      coins: string;
      gems: string;
      is_active: boolean;
    }>('SELECT price_paise, coins, gems, is_active FROM coin_packs WHERE id = $1 FOR UPDATE', [
      input.id,
    ]);
    if (!rows[0]) throw new AppError('PACK_NOT_FOUND', 'That pack does not exist', 404);
    const before = {
      pricePaise: Number(rows[0].price_paise),
      coins: Number(rows[0].coins),
      gems: Number(rows[0].gems),
      isActive: rows[0].is_active,
    };
    if (sameValue(before, next)) throw new AppError('NO_CHANGE', 'Nothing changed', 422);

    await client.query(
      'UPDATE coin_packs SET price_paise = $2, coins = $3, gems = $4, is_active = $5 WHERE id = $1',
      [input.id, next.pricePaise, next.coins, next.gems, next.isActive],
    );
    await recordChange(client, `pack.${input.id}`, before, next, reason, input.actorId);
  });

  invalidateCatalogCache();
  logger.warn('pack edited', { pack_id: input.id, ...next, actor_id: input.actorId, reason });
}

// ── Dials ───────────────────────────────────────────────────────────────────

/**
 * The app_config rows the panel edits as forms. Each names the schema the
 * READING code parses with, so the panel cannot save a value the service
 * would throw away.
 */
export const DIALS = {
  free_coins: { label: 'Free coins', schema: freeCoinsSchema },
  new_user_rewards: { label: 'New-user rewards', schema: newUserRewardsSchema },
  cold_start: { label: 'Cold start', schema: coldStartSchema },
} as const;

export type DialKey = keyof typeof DIALS;
export const DIAL_KEYS = Object.keys(DIALS) as DialKey[];

export function isDialKey(value: string): value is DialKey {
  return Object.prototype.hasOwnProperty.call(DIALS, value);
}

export async function dial<K extends DialKey>(key: K): Promise<z.infer<(typeof DIALS)[K]['schema']> | null> {
  const parsed = DIALS[key].schema.safeParse(await getConfigValue(key));
  return parsed.success ? (parsed.data as z.infer<(typeof DIALS)[K]['schema']>) : null;
}

export async function setDial(input: {
  key: DialKey;
  value: unknown;
  actorId: string;
  reason: string;
}): Promise<void> {
  const reason = cleanReason(input.reason);
  const next = parseOrThrow(DIALS[input.key].schema, input.value);

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ value: unknown }>(
      'SELECT value FROM app_config WHERE key = $1 FOR UPDATE',
      [input.key],
    );
    const before = rows[0]?.value ?? null;
    if (sameValue(before, next)) throw new AppError('NO_CHANGE', 'Nothing changed', 422);

    await client.query(
      `INSERT INTO app_config (key, value, description, updated_by)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
      [input.key, JSON.stringify(next), DIALS[input.key].label, input.actorId],
    );
    await recordChange(client, input.key, before, next, reason, input.actorId);
  });

  invalidateCatalogCache();
  logger.warn('dial changed', { key: input.key, actor_id: input.actorId, reason });
}

// ── Shared ──────────────────────────────────────────────────────────────────

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data as z.infer<S>;
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? issue.path.join('.') + ': ' : '';
  throw new AppError('DIAL_INVALID', `${where}${issue?.message ?? 'Invalid value'}`, 422);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function recordChange(
  client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  key: string,
  before: unknown,
  after: unknown,
  reason: string,
  actorId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO config_changes (id, key, old_value, new_value, reason, actor_user_id)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
    [uuidv7(), key, before === null ? null : JSON.stringify(before), JSON.stringify(after), reason, actorId],
  );
}
