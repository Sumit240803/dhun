// PUBLIC API of the config module: server-driven client configuration.
//
// Anything the app must be able to change without a release belongs here —
// banners, feature flags, and the force-update floor.

export { buildConfigRouter } from './config.routes.js';
export { listBanners } from './banners.service.js';
export type { Banner } from './banners.service.js';
export { coldStartConfig, getClientConfig } from './appConfig.service.js';
export type { ClientConfig, ColdStartConfig } from './appConfig.service.js';
