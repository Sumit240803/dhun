// Auth endpoints.
//
// WORKED EXAMPLE for `api/endpoints/`: one thin function per route, returning a
// typed response. No React, no state, no error handling beyond what the client
// already does — these exist so a feature never builds a URL by hand.

import { api } from '@/api/client';
import type {
  DevicePayload,
  OtpRequestResponse,
  SessionResponse,
  SessionUser,
  TokenPair,
} from '@/api/types';

export const authApi = {
  /** Anonymous session. Called on first launch, before any signup prompt. */
  createGuest: (device: DevicePayload) =>
    api.post<SessionResponse>('auth/guest', { device }, { anonymous: true }),

  requestOtp: (phone: string, channel: 'whatsapp' | 'sms' = 'whatsapp') =>
    api.post<OtpRequestResponse>('auth/otp/request', { phone, channel }, { anonymous: true }),

  /**
   * Verifies the code and signs in.
   *
   * NOT anonymous on purpose: a guest sends their existing token so the server
   * upgrades that account IN PLACE, keeping the id and everything earned before
   * signup. Without it the server creates a fresh user and the guest's balance
   * is stranded.
   */
  verifyOtp: (input: { phone: string; code: string; device: DevicePayload }) =>
    api.post<SessionResponse>('auth/otp/verify', input),

  refresh: (refreshToken: string) =>
    api.post<TokenPair>('auth/refresh', { refreshToken }, { anonymous: true, retries: 0 }),

  me: () => api.get<{ user: SessionUser }>('auth/me'),

  updateProfile: (patch: {
    displayName?: string;
    dateOfBirth?: string;
    gender?: string;
    avatarUrl?: string;
  }) => api.patch<{ user: SessionUser }>('auth/profile', patch),

  logout: (deviceId?: string) => api.post<{ revoked: number }>('auth/logout', { deviceId }),

  /**
   * Email registration.
   *
   * NOT anonymous, for the same reason as verifyOtp: a guest sends their token
   * so the server upgrades that account in place, keeping the id and everything
   * earned before signup.
   */
  registerWithEmail: (input: { email: string; password: string; device: DevicePayload }) =>
    api.post<SessionResponse>('auth/email/register', input),

  loginWithEmail: (input: { email: string; password: string; device: DevicePayload }) =>
    api.post<SessionResponse>('auth/email/login', input, { anonymous: true }),

  /** Sends, or resends, the confirmation code. */
  requestEmailVerification: () => api.post<{ sent: true }>('auth/email/verify/request', {}),

  confirmEmail: (code: string) => api.post<{ verified: true }>('auth/email/verify', { code }),
};
