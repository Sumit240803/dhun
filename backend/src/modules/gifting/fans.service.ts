// Fan levels: how much one person has given one host, read into a number.
//
// Display only. A level is a SUM over gifts already paid, through the ledger,
// at the time they were sent — nothing is paid on reaching one, so nothing
// here touches economy. Cached for a minute per pair: the gateway asks for it
// on every chat line, and a room with a hundred people talking must not run
// a hundred SUMs a second.

import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { getConfigValue } from '../economy/index.js';

export interface FanLevel {
  level: number;
  coins: number;
  /** Coins needed for the next level; null at the top. */
  nextAt: number | null;
}

const schema = z.object({ thresholds: z.array(z.number().int().min(1)).min(1).max(12) }).strict();
const DEFAULT_THRESHOLDS = [1, 2_000, 10_000, 50_000, 200_000, 1_000_000, 5_000_000];

async function thresholds(): Promise<number[]> {
  const parsed = schema.safeParse(await getConfigValue('fan_levels'));
  return parsed.success ? [...parsed.data.thresholds].sort((a, b) => a - b) : DEFAULT_THRESHOLDS;
}

/** Pure: the level a coin total earns against a sorted ladder. */
export function levelFor(coins: number, ladder: number[]): FanLevel {
  let level = 0;
  for (const step of ladder) if (coins >= step) level += 1;
  return { level, coins, nextAt: ladder[level] ?? null };
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 50_000;
const cache = new Map<string, { value: FanLevel; expiresAt: number }>();
const hosts = new Map<string, { hostId: string; expiresAt: number }>();

/** Test seam. */
export function clearFanCache(): void {
  cache.clear();
  hosts.clear();
}

/** A gift just landed: the next read must see it. */
export function invalidateFan(senderId: string, hostId: string): void {
  cache.delete(`${senderId}:${hostId}`);
}

export async function fanLevel(senderId: string, hostId: string): Promise<FanLevel> {
  const key = `${senderId}:${hostId}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const [ladder, { rows }] = await Promise.all([
    thresholds(),
    pool.query<{ coins: string | null }>(
      'SELECT SUM(coins) AS coins FROM gift_sends WHERE sender_user_id = $1 AND recipient_user_id = $2',
      [senderId, hostId],
    ),
  ]);
  const value = levelFor(Number(rows[0]?.coins ?? 0), ladder);
  if (cache.size > MAX_ENTRIES) cache.clear();
  cache.set(key, { value, expiresAt: now + TTL_MS });
  return value;
}

async function hostOf(roomId: string): Promise<string | null> {
  const now = Date.now();
  const hit = hosts.get(roomId);
  if (hit && hit.expiresAt > now) return hit.hostId;
  const { rows } = await pool.query<{ host_user_id: string }>(
    'SELECT host_user_id FROM rooms WHERE id = $1',
    [roomId],
  );
  if (!rows[0]) return null;
  hosts.set(roomId, { hostId: rows[0].host_user_id, expiresAt: now + TTL_MS });
  return rows[0].host_user_id;
}

/** The speaker's fan level with the room's host — 0 for the host themselves. */
export async function fanLevelInRoom(roomId: string, userId: string): Promise<number> {
  const hostId = await hostOf(roomId);
  if (!hostId || hostId === userId) return 0;
  return (await fanLevel(userId, hostId)).level;
}

export async function fanLevelsInRoom(roomId: string, userIds: readonly string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  await Promise.all(
    [...new Set(userIds)].map(async (id) => {
      result.set(id, await fanLevelInRoom(roomId, id));
    }),
  );
  return result;
}
