import { createElement, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

import { useRemoteVideoTrack } from '@/features/room/media';
import { loadVideoView } from '@/features/room/livekit';

interface Props {
  /** Whose camera to draw. */
  userId: string;
  /** Drawn when there is no track — their avatar, almost always. */
  fallback: ReactNode;
  /** `cover` fills the tile and crops; `contain` letterboxes. */
  fit?: 'cover' | 'contain';
}

/**
 * One participant's camera, or their avatar.
 *
 * ── The fallback is the common case ─────────────────────────────────────────
 *
 * A host joins a room several seconds before their camera track arrives; a
 * guest on a video stage may be on mic with the camera off; a listener never
 * had one. Treating "no track" as the normal state rather than an error is what
 * stops a video room being full of black rectangles.
 *
 * ── Why the SDK component is loaded lazily ──────────────────────────────────
 *
 * The same rule as the rest of `livekit.ts`: `@livekit/react-native` touches a
 * native module, and a build made before it was installed must degrade to the
 * fallback rather than put a red screen in front of someone. There is no
 * version of this app where a missing camera should break a room.
 */
/**
 * Resolved ONCE, lazily, and cached at module scope.
 *
 * Not inside the component: a component type produced during render is a new
 * type on every render, so React unmounts and remounts it — which for a video
 * surface means tearing down the track and black-framing whoever is on camera,
 * several times a second in a busy room.
 *
 * `undefined` means "not looked up yet"; `null` means "this build has no
 * LiveKit", which is a normal outcome and draws the fallback forever.
 */

let videoView: ComponentType<any> | null | undefined;

function resolveVideoView(): ComponentType<any> | null {
  if (videoView === undefined) videoView = loadVideoView() ?? null;
  // Re-read into a local so the narrowing above survives: a module-level
  // `let` widens back to its declared type after any assignment.
  const resolved = videoView;
  return resolved === undefined ? null : resolved;
}

export function RemoteVideo({ userId, fallback, fit = 'cover' }: Props) {
  const track = useRemoteVideoTrack(userId);
  const Component = resolveVideoView();

  if (track === null || Component === null) {
    return <View style={[StyleSheet.absoluteFill, styles.fallback]}>{fallback}</View>;
  }

  // `createElement` rather than JSX, because the element type is a value
  // resolved at runtime and JSX here reads as if a component were being
  // defined locally.
  return createElement(Component, {
    videoTrack: track,
    style: StyleSheet.absoluteFill,
    objectFit: fit,
    // Decoration as far as a screen reader is concerned — the tile around this
    // is already labelled with the person's name.
    accessible: false,
  });
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
  },
});
