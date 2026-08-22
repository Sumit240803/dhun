// Server-driven catalog reads.
//
// Day-1 non-negotiable #6: the gift catalog, coin packs, cosmetics and level
// thresholds are CONFIG. Adding a gift or changing a price must never need an
// app release, because old app versions stay alive forever.
//
// Cached briefly in process: every app launch reads all of this, it changes
// rarely, and 30 seconds is short enough that an admin edit feels immediate.

import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';

const CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Called after any admin edit so the change is visible without waiting out the TTL. */
export function invalidateCatalogCache(): void {
  cache.clear();
}

export interface CoinPack {
  id: string;
  name: string;
  pricePaise: number;
  coins: number;
  gems: number;
  badge: string | null;
  playProductId: string | null;
  lifetimeOnce: boolean;
}

export interface Gift {
  id: string;
  name: string;
  tier: number;
  coinPrice: number;
  payoutRateBp: number;
  effect: string;
  animationAsset: string | null;
}

export interface Cosmetic {
  id: string;
  name: string;
  kind: string;
  gemPrice: number;
  durationDays: number | null;
  freeAtUserLevel: number | null;
}

/** `is_active` plus the visibility window — how seasonal and event items are scheduled. */
const VISIBLE =
  ' is_active AND (visible_from IS NULL OR visible_from <= now())' +
  ' AND (visible_to IS NULL OR visible_to > now())';

export async function listCoinPacks(): Promise<CoinPack[]> {
  return cached('packs', async () => {
    const { rows } = await pool.query(
      'SELECT id, name, price_paise, coins, gems, badge, play_product_id, lifetime_once' +
        ' FROM coin_packs WHERE' + VISIBLE + ' ORDER BY sort_order',
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      pricePaise: Number(r.price_paise),
      coins: Number(r.coins),
      gems: Number(r.gems),
      badge: r.badge,
      playProductId: r.play_product_id,
      lifetimeOnce: r.lifetime_once,
    }));
  });
}

/** Bypasses both the cache and the visibility window — a purchase must resolve the exact row. */
export async function getCoinPack(id: string): Promise<CoinPack> {
  const { rows } = await pool.query(
    'SELECT id, name, price_paise, coins, gems, badge, play_product_id, lifetime_once, is_active' +
      ' FROM coin_packs WHERE id = $1',
    [id],
  );
  if (!rows[0]) throw new AppError('PACK_NOT_FOUND', `No coin pack "${id}"`, 404);
  if (!rows[0].is_active) throw new AppError('PACK_UNAVAILABLE', 'That pack is no longer sold', 409);

  return {
    id: rows[0].id,
    name: rows[0].name,
    pricePaise: Number(rows[0].price_paise),
    coins: Number(rows[0].coins),
    gems: Number(rows[0].gems),
    badge: rows[0].badge,
    playProductId: rows[0].play_product_id,
    lifetimeOnce: rows[0].lifetime_once,
  };
}

export async function listGifts(): Promise<Gift[]> {
  return cached('gifts', async () => {
    const { rows } = await pool.query(
      'SELECT id, name, tier, coin_price, payout_rate_bp, effect, animation_asset' +
        ' FROM gift_catalog WHERE' + VISIBLE + ' ORDER BY tier, sort_order',
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      tier: r.tier,
      coinPrice: Number(r.coin_price),
      payoutRateBp: r.payout_rate_bp,
      effect: r.effect,
      animationAsset: r.animation_asset,
    }));
  });
}

export async function getGift(id: string): Promise<Gift> {
  const gifts = await listGifts();
  const gift = gifts.find((g) => g.id === id);
  if (!gift) throw new AppError('GIFT_NOT_FOUND', `No gift "${id}"`, 404);
  return gift;
}

export async function listCosmetics(): Promise<Cosmetic[]> {
  return cached('cosmetics', async () => {
    const { rows } = await pool.query(
      'SELECT id, name, kind, gem_price, duration_days, free_at_user_level' +
        ' FROM cosmetics WHERE' + VISIBLE + ' ORDER BY sort_order',
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      gemPrice: Number(r.gem_price),
      durationDays: r.duration_days,
      freeAtUserLevel: r.free_at_user_level,
    }));
  });
}

/** A dial from app_config. Falls back to the compiled default if the row is missing. */
export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  const all = await cached('config', async () => {
    const { rows } = await pool.query('SELECT key, value FROM app_config');
    return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
  });
  const raw = all[key];
  return typeof raw === 'number' ? raw : fallback;
}

/** Level from cumulative purchased coins (user) or points earned (host). */
export async function levelFor(kind: 'user' | 'host', value: number): Promise<number> {
  const thresholds = await cached(`levels:${kind}`, async () => {
    const { rows } = await pool.query(
      'SELECT level, min_value FROM level_thresholds WHERE kind = $1 ORDER BY min_value',
      [kind],
    );
    return rows.map((r) => ({ level: r.level as number, minValue: Number(r.min_value) }));
  });

  let level = 1;
  for (const t of thresholds) if (value >= t.minValue) level = t.level;
  return level;
}
