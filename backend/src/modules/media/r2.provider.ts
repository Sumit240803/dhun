// Cloudflare R2, behind an interface.
//
// Everything S3-shaped stops in this file. R2 speaks the S3 API, so the client
// is AWS's — but the moment that leaks into four modules, moving to anything
// else (or to a signed-read CDN) becomes a rewrite rather than a swap. Same
// argument as `RtcProvider`: the point of choosing a replaceable vendor is
// being able to replace it.

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../config/index.js';

export interface PresignedUpload {
  /** PUT the bytes here, with exactly the Content-Type that was asked for. */
  url: string;
  key: string;
  expiresInSeconds: number;
}

export interface MediaProvider {
  presignUpload(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<PresignedUpload>;
  /** Size of the stored object, or null if it is not there. */
  statObject(key: string): Promise<{ bytes: number; contentType: string | null } | null>;
}

let client: S3Client | null = null;

function s3(): S3Client {
  client ??= new S3Client({
    region: 'auto',
    endpoint: `https://${config.media.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.media.accessKeyId!,
      secretAccessKey: config.media.secretAccessKey!,
    },
  });
  return client;
}

export const r2: MediaProvider = {
  /**
   * A URL that permits exactly one PUT, of one content type, for a few minutes.
   *
   * `ContentType` is part of the signature, so the client cannot upload
   * something other than what it declared. That matters more than it looks on a
   * PUBLIC bucket: without it, an upload slot requested as `image/jpeg` could
   * be filled with HTML and served from our own domain, which is stored XSS.
   *
   * `ContentLength` is signed too, so the size is agreed before a byte moves
   * rather than discovered after someone uploads a gigabyte.
   */
  async presignUpload({ key, contentType, maxBytes }) {
    const expiresIn = config.media.uploadTtlMinutes * 60;
    const url = await getSignedUrl(
      s3(),
      new PutObjectCommand({
        Bucket: config.media.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: maxBytes,
      }),
      { expiresIn },
    );
    return { url, key, expiresInSeconds: expiresIn };
  },

  async statObject(key) {
    try {
      const head = await s3().send(
        new HeadObjectCommand({ Bucket: config.media.bucket, Key: key }),
      );
      return { bytes: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
    } catch {
      // Any failure means "not usable", which is the only distinction the
      // caller acts on. A 404 and a permissions error are the same answer here.
      return null;
    }
  },
};
