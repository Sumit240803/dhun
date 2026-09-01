// PUBLIC API of the config module: server-driven client configuration.
//
// Anything the app must be able to change without a release belongs here —
// banners, feature flags, and the force-update floor.

export { buildConfigRouter } from './config.routes.js';
export { listBanners } from './banners.service.js';
export type { Banner } from './banners.service.js';
export { getClientConfig } from './appConfig.service.js';
export type { ClientConfig } from './appConfig.service.js';
