// The selfie taken as a host goes live.
//
// ── Why this needs no camera library ────────────────────────────────────────
//
// Because going live is NOT gated on the result. A liveness check — "blink,
// now turn left" — would need `react-native-vision-camera` and ML Kit frame
// processors, since `expo-camera` has no frame processors at all.
//
// We decided against the gate: it fails on real hosts in bad light, and every
// false reject is a host who cannot earn. So all this does is take one photo,
// which `expo-image-picker` already does, and which is already installed.
//
// What the host sees is a face scan before going live, every time, exactly as
// the category does it. The difference is entirely on the server's side.

import * as ImagePicker from 'expo-image-picker';

import { uploadImage, type PickedImage } from '@/features/media/upload';
import { reportError } from '@/lib/reporting';

/**
 * Take the selfie and upload it. Returns the key, or null.
 *
 * NULL IS A NORMAL OUTCOME and the caller must carry on with it: camera
 * permission refused, the host backed out, the upload failed, no network on
 * the hotel wifi. None of those is a reason to stop somebody broadcasting —
 * a missing frame is a gap in a review queue that the next stream fills.
 *
 * Nothing in here throws. A host who cannot go live because a photo failed to
 * upload is the exact failure this design exists to avoid.
 */
export async function captureFaceForGoLive(): Promise<string | null> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;

    const result = await ImagePicker.launchCameraAsync({
      // The front camera, because the point is the host's own face.
      cameraType: ImagePicker.CameraType.front,
      mediaTypes: ['images'],
      // No crop step. Every extra tap before going live is friction on the one
      // action the whole product depends on.
      allowsEditing: false,
      // A reviewer needs to recognise a face, not read a licence plate. 0.6
      // keeps it to a couple of hundred KB on a cheap phone.
      quality: 0.6,
    });

    if (result.canceled || result.assets.length === 0) return null;

    const asset = result.assets[0]!;
    const picked: PickedImage = {
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      fileSize: asset.fileSize,
    };

    // Reuses the avatar purpose: same size limit, same per-user prefix, and
    // the server's `claimUpload` proves the key belongs to this host before it
    // is attached to anything.
    return await uploadImage('avatar', picked);
  } catch (error) {
    reportError(error, { code: 'FACE_CAPTURE_FAILED', screen: 'go-live' });
    return null;
  }
}
