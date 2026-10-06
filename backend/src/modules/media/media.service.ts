// Uploading an image.
//
// The shape, and the reason for it:
//
//   1. The app asks for an upload slot, naming only WHAT the image is for and
//      its content type.
//   2. The server invents the key, signs a one-shot URL for it, and remembers
//      nothing.
//   3. The app PUTs the bytes straight to R2. They never pass through here.
//   4. The app sends the key back with the thing it belongs to — a profile
//      update, a room going live. The server checks the key is one it issued to
//      THIS user, confirms the object is really there, and only then stores it.
//
// THE CLIENT NEVER NAMES A URL. An earlier version of the profile endpoint took
// `avatarUrl: z.string().url()`, which would have let anyone point their avatar
// at any address on the internet — someone else's server, a tracking pixel, or
// content hosted elsewhere that we would then render in every room, chat line
// and leaderboard. The server derives the URL from a key it issued, or there is
// no avatar.

import { randomUUID } from 'crypto';
import { config } from '../../config/index.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { r2, type PresignedUpload } from './r2.provider.js';

/** What an upload is for. Each has its own size ceiling and key prefix. */
export const UPLOAD_PURPOSES = ['avatar', 'room_cover'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/**
 * Only formats every phone can produce and every client can draw.
 *
 * No SVG, deliberately: it is a document, it can carry script, and on a public
 * bucket served from our own domain that is stored XSS rather than a picture.
 */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const LIMITS: Record<UploadPurpose, { maxBytes: number; prefix: string }> = {
  // An avatar is drawn at 96px at its largest. 3MB is already generous and
  // exists to catch an unprocessed camera original, not to permit one.
  avatar: { maxBytes: 3 * 1024 * 1024, prefix: 'avatars' },
  // A cover fills a feed tile and is seen at roughly 600×800.
  room_cover: { maxBytes: 5 * 1024 * 1024, prefix: 'covers' },
};

function requireConfigured(): void {
  if (!config.media.configured) {
    // The same shape as RTC being absent: the rest of the app runs, and the
    // endpoints that need this one dependency say so cleanly.
    throw new AppError('MEDIA_UNAVAILABLE', 'Image uploads are not available right now', 503);
  }
}

export function isMediaConfigured(): boolean {
  return config.media.configured;
}

/**
 * The public address of a stored object.
 *
 * Composed at write time from config, never typed by a client. When the bucket
 * moves from its r2.dev subdomain to a real domain, every stored URL is
 * regenerated from its key — which is why the key is kept at all.
 */
export function publicUrlFor(key: string): string {
  return `${config.media.publicUrl}/${key}`;
}

/**
 * Issue a one-shot upload slot.
 *
 * The key is `{prefix}/{userId}/{uuid}.{ext}`. Two properties matter:
 * it is scoped to the user, so a key can be checked against whoever is
 * presenting it; and it ends in a random uuid, so nobody can guess, overwrite
 * or enumerate anybody else's images.
 */
export async function createUpload(
  userId: string,
  purpose: UploadPurpose,
  contentType: string,
): Promise<PresignedUpload & { purpose: UploadPurpose; maxBytes: number }> {
  requireConfigured();

  const extension = ALLOWED_TYPES[contentType];
  if (!extension) {
    throw new AppError('UNSUPPORTED_IMAGE_TYPE', 'That image format is not supported', 422, {
      allowed: Object.keys(ALLOWED_TYPES),
    });
  }

  const { maxBytes, prefix } = LIMITS[purpose];
  const key = `${prefix}/${userId}/${randomUUID()}.${extension}`;
  const upload = await r2.presignUpload({ key, contentType, maxBytes });

  logger.info('upload presigned', { user_id: userId, purpose, key });
  return { ...upload, purpose, maxBytes };
}

/**
 * Accept a key a client claims to have uploaded, and hand back its URL.
 *
 * Two checks, and neither is optional:
 *
 *   · the key must sit under THIS user's prefix, so one person cannot claim
 *     another's upload — or any other object in the bucket;
 *   · the object must actually exist, so a profile never ends up pointing at an
 *     upload that was abandoned halfway and shows a broken image forever.
 */
export async function claimUpload(
  userId: string,
  purpose: UploadPurpose,
  key: string,
): Promise<{ key: string; url: string }> {
  requireConfigured();

  const expectedPrefix = `${LIMITS[purpose].prefix}/${userId}/`;
  if (!key.startsWith(expectedPrefix) || key.includes('..')) {
    throw new AppError('UPLOAD_NOT_YOURS', 'That upload does not belong to you', 403);
  }

  const stat = await r2.statObject(key);
  if (stat === null) {
    throw new AppError('UPLOAD_NOT_FOUND', 'That upload has not finished', 409);
  }
  if (stat.bytes > LIMITS[purpose].maxBytes) {
    throw new AppError('UPLOAD_TOO_LARGE', 'That image is too large', 413, {
      maxBytes: LIMITS[purpose].maxBytes,
    });
  }

  return { key, url: publicUrlFor(key) };
}
