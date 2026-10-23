// PUBLIC API of the config module: server-driven client configuration.
//
// Anything the app must be able to change without a release belongs here —
// banners, feature flags, and the force-update floor.

export { buildConfigRouter } from './config.routes.js';
export { listBanners } from './banners.service.js';
export type { Banner } from './banners.service.js';
export {
  coldStartConfig,
  getClientConfig,
  roomBackgroundPath,
  roomBackgrounds,
} from './appConfig.service.js';
export type { ClientConfig, ColdStartConfig, RoomBackground } from './appConfig.service.js';
export {
  appVersions,
  assertFeature,
  FEATURE_KEYS,
  FEATURES,
  featureEnabled,
  featureStates,
  isFeatureKey,
  recentConfigChanges,
  requireFeature,
  setAppVersions,
  setFeature,
} from './features.js';
export type { AppVersions, ConfigChange, FeatureKey, FeatureSpec } from './features.js';
export {
  adminGifts,
  adminPacks,
  DIAL_KEYS,
  DIALS,
  dial,
  isDialKey,
  setDial,
  updateGift,
  updatePack,
} from './catalog.admin.js';
export type { AdminGift, AdminPack, DialKey } from './catalog.admin.js';
