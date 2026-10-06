// Putting an image on the server.
//
// Three steps, and the middle one does not touch our API at all:
//
//   1. ask the backend for an upload slot — it names the key, we do not;
//   2. PUT the bytes straight to Cloudflare R2 using the signed URL;
//   3. hand the KEY back with whatever it belongs to — a profile, a room.
//
// The bytes never pass through our server, which is the same reasoning as
// LiveKit media: a photo upload has no business occupying an API worker, and
// the moment it does, a slow connection holds one open for a minute.

import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '@/api/client';

export type UploadPurpose = 'avatar' | 'room_cover';

interface UploadSlot {
  url: string;
  key: string;
  expiresInSeconds: number;
  maxBytes: number;
}

/** What the picker gives back, narrowed to what an upload needs. */
export interface PickedImage {
  uri: string;
  mimeType: string;
  fileSize?: number;
}

/**
 * Ask for a photo, cropped where the app will draw it.
 *
 * Square for an avatar, 3:4 for a room cover — done in the system cropper so
 * the person sees the frame they will actually appear in, rather than
 * discovering afterwards that their face is cut off.
 */
export async function pickImage(purpose: UploadPurpose): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: purpose === 'avatar' ? [1, 1] : [3, 4],
    // Re-encoded by the picker before it leaves the phone. A modern camera
    // original is 6–12MB and none of that survives being drawn at 96px.
    quality: 0.8,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    // The picker can return an unknown type for some gallery sources; the
    // server only accepts three, and jpeg is what `quality` produces.
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileSize: asset.fileSize,
  };
}

/**
 * Upload a picked image and return the key to attach to something.
 *
 * The size is checked here as well as on the server, because finding out after
 * a slow upload that the file was too big is the worst possible moment to be
 * told.
 */
export async function uploadImage(purpose: UploadPurpose, image: PickedImage): Promise<string> {
  const slot = await api.post<UploadSlot>('media/uploads', {
    purpose,
    contentType: image.mimeType,
  });

  if (image.fileSize !== undefined && image.fileSize > slot.maxBytes) {
    throw new ApiError('UPLOAD_TOO_LARGE', 'That image is too large', 413, {
      maxBytes: slot.maxBytes,
    });
  }

  // React Native turns a file:// uri into a stream for fetch when it is given
  // as a blob. `Content-Type` must match what was signed exactly, or R2
  // rejects the signature.
  const body = await fetch(image.uri).then((res) => res.blob());
  const put = await fetch(slot.url, {
    method: 'PUT',
    headers: { 'Content-Type': image.mimeType },
    body,
  });

  if (!put.ok) {
    // The bucket's own error body is XML and means nothing to a user; the
    // screen that called this turns the code into a sentence.
    throw new ApiError('UPLOAD_FAILED', 'The image could not be uploaded', put.status);
  }

  return slot.key;
}

/** Pick and upload in one step. Null when the person backed out. */
export async function pickAndUpload(purpose: UploadPurpose): Promise<string | null> {
  const image = await pickImage(purpose);
  if (image === null) return null;
  return uploadImage(purpose, image);
}
