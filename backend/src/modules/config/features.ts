// Kill switches — one per feature, thrown from the admin panel.
//
// Day-1 non-negotiable #5 and the incident rule in development-pipeline.md:
// "kill switch first, fix second". For that to be true a switch has to be ONE
// action that stops a feature everywhere at once:
//
//   · on the server  — `requireFeature()` refuses the request;
//   · in the ledger  — the feature's transaction types go `is_active = false`,
//                      so a client that never asks (a modified build, an old
//                      version) still cannot move coins;
//   · in the app     — the matching client flag goes false in the next config
//                      fetch and the screen hides or shows its paused state.
//
// Every flip is recorded in `config_changes` with who and why.
//
// A feature absent from the config row is ON. The row exists to switch things
// off on purpose; a missing key or a malformed row must never switch the
// product off by accident.

import type { NextFunction, Request, Response } from 'express';
import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { getConfigValue, invalidateCatalogCache } from '../economy/index.js';

export interface FeatureSpec {
  /** Shown on the switches page and in the refusal message. */
  label: string;
  /** One line for the switches page: what going OFF does. */
  description: string;
  /** The client flag this drives, if the app has a screen to hide. */
  clientFlag: string | null;
  /** Ledger transaction types that go inactive with it. The money-layer half. */
  txnTypes: readonly string[];
}

export const FEATURES = {
  gifting: {
    label: 'Gifting',
    description: 'Gift sends are refused and the gift tray is hidden. Nothing already sent is touched.',
    clientFlag: 'giftingEnabled',
    txnTypes: ['gift_send'],
  },
  purchases: {
    label: 'Coin purchases',
    description: 'Play billing and web purchases are refused. Agency inventory transfers are a separate switch.',
    clientFlag: 'purchasesEnabled',
    txnTypes: ['purchase_iap', 'purchase_web'],
  },
  conversion: {
    label: 'Coins to gems',
    description: 'The conversion is refused and its button hidden. Use when the rate is being retuned.',
    clientFlag: 'conversionEnabled',
    txnTypes: ['coin_to_gem_conversion'],
  },
  cosmetics: {
    label: 'Cosmetics store',
    description: 'Buying frames, bubbles and effects is refused. Items already owned keep working.',
    clientFlag: 'cosmeticsEnabled',
    txnTypes: ['cosmetic_purchase'],
  },
  goLive: {
    label: 'Going live',
    description: 'No new rooms can start. Rooms already live are NOT ended — end those from Live rooms.',
    clientFlag: 'goLiveEnabled',
    txnTypes: [],
  },
  videoRooms: {
    label: 'Video rooms',
    description: 'New rooms must be audio-only. Off by default until video is verified on devices.',
    clientFlag: 'videoRoomsEnabled',
    txnTypes: [],
  },
  pk: {
    label: 'PK battles',
    description: 'Invites and matchmaking are refused. Battles already running finish on their own.',
    clientFlag: null,
    txnTypes: [],
  },
  rewards: {
    label: 'Free coins',
    description: 'Check-in, welcome, watch, referral and new-user rewards stop paying. The sheets are hidden.',
    clientFlag: 'rewardsEnabled',
    txnTypes: ['free_coin_grant'],
  },
  agencyCoins: {
    label: 'Agency coin transfers',
    description: 'Agencies cannot move inventory to users. Prepays are unaffected.',
    clientFlag: 'agencyCoinsEnabled',
    txnTypes: ['purchase_reseller'],
  },
} as const satisfies Record<string, FeatureSpec>;

export type FeatureKey = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, value);
}

/** Every feature's state. Missing or malformed keys read as ON. */
export async function featureStates(): Promise<Record<FeatureKey, boolean>> {
  const raw = await getConfigValue('features');
  const row = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, row[key] !== false]),
  ) as Record<FeatureKey, boolean>;
}

export async function featureEnabled(key: FeatureKey): Promise<boolean> {
  return (await featureStates())[key];
}

/** The client flags the switches imply, merged over `client_flags` by getClientConfig. */
export async function featureFlags(): Promise<Record<string, boolean>> {
  const states = await featureStates();
  const flags: Record<string, boolean> = {};
  for (const key of FEATURE_KEYS) {
    const flag = FEATURES[key].clientFlag;
    if (flag) flags[flag] = states[key];
  }
  return flags;
}

export class FeatureDisabledError extends AppError {
  constructor(key: FeatureKey) {
    // 403, not 503. The API client retries a 503 with backoff, which would
    // only delay telling the user; a paused feature is a refusal, not an
    // outage, and the message is written to be shown.
    super('FEATURE_DISABLED', `${FEATURES[key].label} is paused right now`, 403, {
      feature: key,
    });
  }
}

/**
 * Refuses the request while the feature is switched off.
 *
 * Sits after auth and before the rate limiter on every route it guards, so a
 * paused feature costs one cached config read and nothing else.
 */
export function requireFeature(key: FeatureKey) {
  return async (_req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!(await featureEnabled(key))) return next(new FeatureDisabledError(key));
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Throws FEATURE_DISABLED. For a check inside a handler, where middleware cannot see the body. */
export async function assertFeature(key: FeatureKey): Promise<void> {
  if (!(await featureEnabled(key))) throw new FeatureDisabledError(key);
}

// ── Flipping a switch ───────────────────────────────────────────────────────

export interface SwitchInput {
  key: FeatureKey;
  enabled: boolean;
  actorId: string;
  reason: string;
}

export function cleanReason(reason: string): string {
  const trimmed = reason.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 3) {
    throw new AppError('REASON_REQUIRED', 'Say why — it goes in the log', 422);
  }
  return trimmed.slice(0, 500);
}

/**
 * The one action. Config row, ledger transaction types and the change record
 * are written in a single transaction, so there is no moment where the app
 * says a feature is on while the ledger refuses it, or the reverse.
 */
export async function setFeature(input: SwitchInput): Promise<void> {
  const reason = cleanReason(input.reason);
  const spec = FEATURES[input.key];

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ value: Record<string, unknown> | null }>(
      "SELECT value FROM app_config WHERE key = 'features' FOR UPDATE",
    );
    const current = rows[0]?.value ?? {};
    const before = current[input.key] !== false;

    await client.query(
      `INSERT INTO app_config (key, value, description, updated_by)
       VALUES ('features', jsonb_build_object($1::text, $2::boolean), 'Kill switches, one per feature.', $3)
       ON CONFLICT (key) DO UPDATE
         SET value = app_config.value || jsonb_build_object($1::text, $2::boolean),
             updated_by = $3`,
      [input.key, input.enabled, input.actorId],
    );

    if (spec.txnTypes.length > 0) {
      await client.query(
        'UPDATE ledger_txn_types SET is_active = $1 WHERE code = ANY($2::text[])',
        [input.enabled, [...spec.txnTypes]],
      );
    }

    await client.query(
      `INSERT INTO config_changes (id, key, old_value, new_value, reason, actor_user_id)
       VALUES ($1, $2, to_jsonb($3::boolean), to_jsonb($4::boolean), $5, $6)`,
      [uuidv7(), `features.${input.key}`, before, input.enabled, reason, input.actorId],
    );
  });

  invalidateCatalogCache();
  logger.warn('kill switch flipped', {
    feature: input.key,
    enabled: input.enabled,
    actor_id: input.actorId,
    reason,
  });
}

// ── App versions ────────────────────────────────────────────────────────────

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

function versionParts(value: string): number[] {
  return value.split('.').map(Number);
}

function olderThan(a: string, b: string): boolean {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if (left[i]! !== right[i]!) return left[i]! < right[i]!;
  }
  return false;
}

export interface VersionsInput {
  minSupported: string;
  latest: string;
  storeUrl: string;
  actorId: string;
  reason: string;
}

export interface AppVersions {
  minSupported: string;
  latest: string;
  storeUrl: string;
}

export async function appVersions(): Promise<AppVersions> {
  const [min, latest, store] = await Promise.all([
    getConfigValue('min_supported_app_version'),
    getConfigValue('latest_app_version'),
    getConfigValue('store_url_android'),
  ]);
  return {
    minSupported: typeof min === 'string' ? min : '1.0.0',
    latest: typeof latest === 'string' ? latest : '1.0.0',
    storeUrl: typeof store === 'string' ? store : '',
  };
}

/**
 * Moves the version floor and the suggested version.
 *
 * The floor is the bluntest instrument the product has — a user below it
 * cannot open the app — so it is validated hard: a real version string, never
 * above the latest, and never moved without a reason.
 */
export async function setAppVersions(input: VersionsInput): Promise<void> {
  const reason = cleanReason(input.reason);
  const minSupported = input.minSupported.trim();
  const latest = input.latest.trim();
  const storeUrl = input.storeUrl.trim();

  if (!SEMVER.test(minSupported) || !SEMVER.test(latest)) {
    throw new AppError('VERSION_INVALID', 'Versions look like 1.2.3', 422);
  }
  if (olderThan(latest, minSupported)) {
    throw new AppError(
      'VERSION_FLOOR_ABOVE_LATEST',
      'The minimum version cannot be newer than the latest version',
      422,
    );
  }
  if (storeUrl !== '' && !/^https:\/\/[^\s]{4,500}$/.test(storeUrl)) {
    throw new AppError('STORE_URL_INVALID', 'The store link must start with https://', 422);
  }

  const before = await appVersions();
  const writes: [key: string, previous: string, next: string][] = [
    ['min_supported_app_version', before.minSupported, minSupported],
    ['latest_app_version', before.latest, latest],
    ['store_url_android', before.storeUrl, storeUrl],
  ];

  await withTransaction(async (client) => {
    for (const [key, previous, next] of writes) {
      if (previous === next) continue;
      await client.query(
        `UPDATE app_config SET value = to_jsonb($2::text), updated_by = $3 WHERE key = $1`,
        [key, next, input.actorId],
      );
      await client.query(
        `INSERT INTO config_changes (id, key, old_value, new_value, reason, actor_user_id)
         VALUES ($1, $2, to_jsonb($3::text), to_jsonb($4::text), $5, $6)`,
        [uuidv7(), key, previous, next, reason, input.actorId],
      );
    }
  });

  invalidateCatalogCache();
  logger.warn('app versions changed', { ...input, reason, actor_id: input.actorId });
}

// ── The record ──────────────────────────────────────────────────────────────

export interface ConfigChange {
  id: string;
  key: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  actorName: string | null;
  at: string;
}

export async function recentConfigChanges(limit = 50): Promise<ConfigChange[]> {
  const { rows } = await pool.query<{
    id: string;
    key: string;
    old_value: unknown;
    new_value: unknown;
    reason: string;
    actor_name: string | null;
    created_at: Date;
  }>(
    `SELECT c.id, c.key, c.old_value, c.new_value, c.reason, p.display_name AS actor_name, c.created_at
       FROM config_changes c
       LEFT JOIN user_profiles p ON p.user_id = c.actor_user_id
      ORDER BY c.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    oldValue: row.old_value,
    newValue: row.new_value,
    reason: row.reason,
    actorName: row.actor_name,
    at: row.created_at.toISOString(),
  }));
}
