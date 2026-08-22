// The ONLY file that reads process.env.
//
// Validated at import time, so a misconfigured build fails at launch rather than
// at the payment screen — which is where you would otherwise discover that
// EXPO_PUBLIC_API_URL was empty.
//
// EXPO_PUBLIC_* values are INLINED INTO THE BUNDLE at build time and are readable
// by anyone holding the APK. They are configuration, never secrets. There is no
// such thing as a secret in a mobile app; anything sensitive stays on the server.

import Constants from 'expo-constants';

type AppEnvironment = 'development' | 'staging' | 'production';

function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(
      `Missing ${name}. Set it in .env for local development, or in the eas.json ` +
        `build profile — EAS builds never see your local .env file.`,
    );
  }
  return value.trim();
}

const apiUrl = required('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL);

// A physical device resolves localhost to ITSELF, so it can never reach a server
// on the development machine. This is the single most common setup mistake, and
// it surfaces as an unexplained network error rather than anything useful.
if (__DEV__ && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(apiUrl)) {
  console.warn(
    `[config] EXPO_PUBLIC_API_URL is ${apiUrl}. That works in a simulator but ` +
      `NOT on a physical device — use your machine's LAN address instead.`,
  );
}

export const env = {
  apiUrl: apiUrl.replace(/\/+$/, ''),

  /** Crash reporting. Empty is valid and means reporting is disabled. */
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || undefined,
  environment: (process.env.EXPO_PUBLIC_ENV ?? 'development') as AppEnvironment,

  get isProduction() {
    return this.environment === 'production';
  },

  /** From app.json, so it matches what the store shows. */
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
  /** Bumped by EAS per build (appVersionSource: remote). */
  buildNumber:
    Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber ?? 'dev',
} as const;
