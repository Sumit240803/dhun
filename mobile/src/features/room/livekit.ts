// The LiveKit runtime, loaded on demand.
//
// ── Why this is lazy, and why that is not over-engineering ────────────────────
//
// `registerGlobals()` installs WebRTC polyfills and touches a NATIVE module.
// Any build made before `@livekit/react-native` was installed has no such
// module, and importing it eagerly puts a red error in front of every user of
// an older build — on screens that have nothing to do with rooms.
//
// The same lesson the MSG91 widget taught, applied before it costs anything:
// a native dependency is loaded where it is used, behind a guard, and its
// absence is a degraded feature rather than a broken app.
//
// ── The other half: audio routing ────────────────────────────────────────────
//
// `AudioSession.startAudioSession()` is what tells the OS this is a voice call
// rather than media playback. Without it Android routes audio to the earpiece
// at call volume, iOS ducks it under other apps, and the microphone may not
// open at all. It has to be stopped again on leaving, or every later sound in
// the app keeps the call routing.

import { reportError } from '@/lib/reporting';

interface LiveKitRuntime {
  registerGlobals: () => void;
  AudioSession: {
    startAudioSession: () => Promise<void>;
    stopAudioSession: () => Promise<void>;
  };
}

let runtime: LiveKitRuntime | null | undefined;
let globalsRegistered = false;

/**
 * Loads the SDK, or returns null when it is not in this build.
 *
 * Null is a normal outcome, not an error — it means "this build predates
 * LiveKit", and the caller shows a message rather than crashing.
 */
function load(): LiveKitRuntime | null {
  if (runtime !== undefined) return runtime;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    runtime = require('@livekit/react-native') as LiveKitRuntime;
  } catch (error) {
    reportError(error, { code: 'LIVEKIT_MODULE_MISSING', screen: 'room' });
    runtime = null;
  }

  return runtime;
}

/** Whether a live room can actually be joined in this build. */
export function isLiveKitAvailable(): boolean {
  return load() !== null;
}

/**
 * Installs the WebRTC globals. Idempotent — safe to call on every room open.
 *
 * Must run before anything from `livekit-client` is constructed, which is why
 * the Room hook calls it rather than trusting an import-order coincidence.
 */
export function ensureLiveKitReady(): boolean {
  const sdk = load();
  if (!sdk) return false;

  if (!globalsRegistered) {
    sdk.registerGlobals();
    globalsRegistered = true;
  }
  return true;
}

/**
 * Puts the OS into voice-call audio mode.
 *
 * Failures are logged and swallowed. A room that connects with imperfect audio
 * routing is worth far more than one that refuses to open — and on some
 * devices this throws for reasons entirely outside our control.
 */
export async function startAudioSession(): Promise<void> {
  const sdk = load();
  if (!sdk) return;

  try {
    await sdk.AudioSession.startAudioSession();
  } catch (error) {
    reportError(error, { code: 'AUDIO_SESSION_START_FAILED', screen: 'room' });
  }
}

/** Releases voice-call routing. Must run on leaving, however the screen closed. */
export async function stopAudioSession(): Promise<void> {
  const sdk = load();
  if (!sdk) return;

  try {
    await sdk.AudioSession.stopAudioSession();
  } catch {
    // Nothing useful to do, and nothing the user can act on. The OS reclaims
    // the session when the process ends regardless.
  }
}
