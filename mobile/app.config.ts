import { existsSync } from 'node:fs';

import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json holds the config. This file adds the one value that cannot live
 * there: where google-services.json is (docs/firebase-push.md).
 *
 * The repository is public, so the file is never committed. An EAS build gets
 * it from the GOOGLE_SERVICES_JSON file variable, which EAS sets to a path on
 * the build machine. A local build uses mobile/google-services.json if it is
 * there.
 *
 * With neither, the build still succeeds, with push disabled. registerForPush
 * reports the failure and the app carries on, which is right for a branch
 * build or a contributor without the Firebase project.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ??
    (existsSync('./google-services.json') ? './google-services.json' : undefined);

  return {
    ...(config as ExpoConfig),
    android: {
      ...config.android,
      ...(googleServicesFile !== undefined ? { googleServicesFile } : {}),
    },
  };
};
