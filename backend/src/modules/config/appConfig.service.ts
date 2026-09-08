import { getConfigNumber } from '../economy/index.js';
import { pool } from '../../infra/db.js';

export interface OtpWidgetConfig {
  enabled: boolean;
  widgetId: string;
  /**
   * PUBLIC by construction — it ships to the app and an APK is readable.
   * Served from config rather than bundled so it can be rotated or revoked
   * without a release. The account authkey is a different credential and never
   * appears here.
   */
  tokenAuth: string;
}

export interface ClientConfig {
  flags: Record<string, boolean>;
  otpWidget: OtpWidgetConfig;
  /** Below this, the app blocks with an update prompt it cannot dismiss. */
  minSupportedVersion: string;
  /** Below this, the app offers an update the user can decline. */
  latestVersion: string;
  storeUrl: string;
}

/**
 * Everything the app needs to know at launch that is not user data.
 *
 * This is day-1 non-negotiable #5 — force-update plus a remote kill switch per
 * major feature. The client half has existed since the foundation
 * (`applyRemoteFlags`); this is what finally feeds it.
 *
 * Flags here are the NON-money switches. The money layer has a stronger one:
 * `ledger_txn_types.is_active` stops a flow inside the transaction itself, so
 * a client that ignores a flag — or a modified build that never asks — still
 * cannot move coins. A client-side flag hides a screen; it never guards money.
 */
export async function getClientConfig(): Promise<ClientConfig> {
  const { rows } = await pool.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM app_config
      WHERE key IN ('client_flags','min_supported_app_version','latest_app_version',
                    'store_url_android','otp_widget_enabled','otp_widget_id',
                    'otp_widget_token_auth')`,
  );

  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const rawFlags = byKey.client_flags;

  return {
    // Only booleans survive. A malformed row must not be able to hand the app
    // a string where it expects a switch.
    flags:
      rawFlags !== null && typeof rawFlags === 'object'
        ? Object.fromEntries(
            Object.entries(rawFlags as Record<string, unknown>).filter(
              ([, value]) => typeof value === 'boolean',
            ),
          ) as Record<string, boolean>
        : {},
    // Enabled only when it is BOTH switched on and actually configured. A
    // half-filled row would send the app down a path that cannot work, and the
    // failure would surface as a broken login rather than a missing setting.
    otpWidget: {
      enabled:
        byKey.otp_widget_enabled === true &&
        asString(byKey.otp_widget_id, '') !== '' &&
        asString(byKey.otp_widget_token_auth, '') !== '',
      widgetId: asString(byKey.otp_widget_id, ''),
      tokenAuth: asString(byKey.otp_widget_token_auth, ''),
    },

    minSupportedVersion: asString(byKey.min_supported_app_version, '1.0.0'),
    latestVersion: asString(byKey.latest_app_version, '1.0.0'),
    storeUrl: asString(byKey.store_url_android, ''),
  };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

// Re-exported so the config module has one obvious place to read numbers from
// as it grows, rather than every caller reaching into economy.
export { getConfigNumber };
