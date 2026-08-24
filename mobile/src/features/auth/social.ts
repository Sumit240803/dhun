// Social sign-in.
//
// ⚠️ MOCKED. There is no `/v1/auth/social` route yet — this file exists so the
// login screen can be built and clicked through before the backend lands, and
// so that swapping in the real exchange is ONE function, not a screen rewrite.
//
// To go live: implement `exchange()` against the backend, set MOCK to false,
// and delete `mockExchange`. Nothing in the UI changes.
//
// ── What the real thing will look like ────────────────────────────────────
// Each SDK returns a provider token on device. That token goes to the backend,
// which verifies it WITH THE PROVIDER (never trusting the client), then either
// links it to an existing user or creates one, and returns the same
// SessionResponse the OTP flow already returns. The client half stays this thin.
//
// ── Per-provider reality, worth knowing before building the backend ───────
// · Google    — Credential Manager on Android, Sign in with Apple required on
//               iOS if this ships there. Needs the Play/Firebase client ids,
//               which need the Google Cloud project, which needs the entity.
// · Facebook  — a Facebook app plus Business Verification. Weeks, not days.
// · Instagram — Instagram Basic Display was SHUT DOWN in December 2024.
//               Consumer "Log in with Instagram" no longer exists for third
//               parties. What remains is Instagram API with Instagram Login,
//               which covers PROFESSIONAL (business/creator) accounts only and
//               runs through Facebook. For a host-facing app that is arguably
//               fine; for ordinary viewers it will not work at all.

import { authApi } from '@/api/endpoints/auth';
import type { SessionResponse } from '@/api/types';
import { getDevicePayload } from '@/features/auth/device';

export type SocialProvider = 'google' | 'facebook' | 'instagram';

export const SOCIAL_PROVIDERS: SocialProvider[] = ['google', 'facebook', 'instagram'];

/** Flip to false the moment `exchange()` is real. */
export const MOCK = true;

/**
 * Signs in with a provider and returns a session.
 *
 * The mock creates a REAL guest session rather than fabricating tokens: fake
 * tokens would sail through this function and then 401 on every subsequent
 * call, which is a far more confusing thing to debug than a guest account.
 */
export async function signInWithProvider(provider: SocialProvider): Promise<SessionResponse> {
  if (MOCK) return mockExchange(provider);
  return exchange(provider);
}

/** The real implementation. Not built yet — see the header. */
async function exchange(_provider: SocialProvider): Promise<SessionResponse> {
  throw new Error('Social sign-in is not implemented yet');
}

async function mockExchange(provider: SocialProvider): Promise<SessionResponse> {
  if (__DEV__) {
    console.warn(
      `[auth] MOCK social sign-in as "${provider}" — a guest session is being created instead. ` +
        'See features/auth/social.ts.',
    );
  }
  // A short, visible delay: without one the button never shows its loading
  // state, and the spinner is a real part of the design being reviewed.
  await new Promise((resolve) => setTimeout(resolve, 600));
  return authApi.createGuest(await getDevicePayload());
}
