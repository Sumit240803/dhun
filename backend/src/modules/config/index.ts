// PUBLIC API of the config module: server-driven client configuration.
//
// Anything the app must be able to change without a release belongs here —
// banners today; force-update thresholds and remote feature flags next.

export { buildConfigRouter } from './config.routes.js';
export { listBanners } from './banners.service.js';
export type { Banner } from './banners.service.js';
