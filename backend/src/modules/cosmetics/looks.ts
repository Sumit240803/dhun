// How people appear: the cosmetics they are wearing right now.
//
// Read on EVERY chat line and seat map, in both the API and the gateway, so it
// is batched (one query for a whole seat map) and cached briefly per process.
// Fifteen seconds is the longest anyone waits to see a newly equipped frame in
// someone else's room — a fair trade against a query per chat message.
//
// Expiry is evaluated right here, in the query. Nothing sweeps expired rows;
// a lapsed item stops appearing the moment its time passes (ledger § C11d).

import { pool } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';
import {
  EMPTY_LOOK,
  isWearable,
  parseCosmeticStyle,
  type UserLook,
} from '../../shared/cosmeticStyle.js';

const TTL_MS = 15_000;
/** A room is at most a few hundred people; this bounds a runaway process. */
const MAX_ENTRIES = 5_000;

const cache = new Map<string, { look: UserLook; expiresAt: number }>();

/** Drops a user's cached look — after they buy or equip something. */
export function invalidateLook(userId: string): void {
  cache.delete(userId);
}

/** Test seam. */
export function clearLookCache(): void {
  cache.clear();
}

/** Looks for many people in one query. Every requested id is in the result. */
export async function looksFor(userIds: readonly string[]): Promise<Map<string, UserLook>> {
  const now = Date.now();
  const result = new Map<string, UserLook>();
  const missing: string[] = [];

  for (const id of new Set(userIds)) {
    const hit = cache.get(id);
    if (hit && hit.expiresAt > now) result.set(id, hit.look);
    else missing.push(id);
  }
  if (missing.length === 0) return result;

  const { rows } = await pool.query<{
    user_id: string;
    kind: string;
    cosmetic_id: string;
    asset: string | null;
    style: unknown;
  }>(
    `SELECT uc.user_id, uc.kind, c.id AS cosmetic_id, c.asset, c.style
       FROM user_cosmetics uc
       JOIN cosmetics c ON c.id = uc.cosmetic_id
      WHERE uc.user_id = ANY($1::uuid[])
        AND uc.equipped
        AND uc.expires_at > now()`,
    [missing],
  );

  const built = new Map<string, UserLook>(missing.map((id) => [id, { ...EMPTY_LOOK }]));

  for (const row of rows) {
    const look = built.get(row.user_id)!;
    if (!isWearable(row.kind)) continue;

    // An item whose style was broken after someone bought it draws nothing,
    // rather than throwing inside a room for everyone who can see them.
    switch (row.kind) {
      case 'frame': {
        const style = parseCosmeticStyle('frame', row.style);
        if (style) look.frame = { asset: row.asset, style };
        else warnInvalid(row.cosmetic_id);
        break;
      }
      case 'chat_bubble': {
        look.bubble = parseCosmeticStyle('chat_bubble', row.style);
        if (!look.bubble) warnInvalid(row.cosmetic_id);
        break;
      }
      case 'nickname_color': {
        look.nameColor = parseCosmeticStyle('nickname_color', row.style);
        if (!look.nameColor) warnInvalid(row.cosmetic_id);
        break;
      }
      case 'entry_effect': {
        const style = parseCosmeticStyle('entry_effect', row.style);
        if (style) look.entry = { asset: row.asset, style };
        else warnInvalid(row.cosmetic_id);
        break;
      }
    }
  }

  if (cache.size > MAX_ENTRIES) cache.clear();
  for (const [id, look] of built) {
    cache.set(id, { look, expiresAt: now + TTL_MS });
    result.set(id, look);
  }
  return result;
}

export async function lookFor(userId: string): Promise<UserLook> {
  return (await looksFor([userId])).get(userId) ?? EMPTY_LOOK;
}

function warnInvalid(cosmeticId: string): void {
  logger.error('equipped cosmetic has an invalid style', { cosmetic_id: cosmeticId });
}
