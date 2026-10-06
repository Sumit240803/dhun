// PUBLIC API of the media module.
//
// Presigned image uploads to Cloudflare R2. The bytes never pass through this
// server: it issues a one-shot URL, the app uploads straight to the bucket, and
// the key comes back to be claimed. Nothing here accepts a URL from a client.

export { buildMediaRouter } from './media.routes.js';

export { claimUpload, createUpload, isMediaConfigured, publicUrlFor } from './media.service.js';
export type { UploadPurpose } from './media.service.js';
