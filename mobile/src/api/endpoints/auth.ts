// Auth endpoints.
//
// WORKED EXAMPLE for `api/endpoints/`: one thin function per route, returning a
// typed response. No React, no state, no error handling beyond what the client
// already does — these exist so a feature never builds a URL by hand.

import { api } from '@/api/client';
import type {
  ActiveSession,
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

  /**
   * Exchanges an MSG91 widget access token for a session.
   *
   * NOT anonymous, for the same reason as verifyOtp: a guest sends their token
   * so the server upgrades that account in place.
   *
   * The access token is not proof on its own — the server confirms it with the
   * account authkey before trusting a single field of it.
   */
  verifyWidgetToken: (input: { accessToken: string; device: DevicePayload }) =>
    api.post<SessionResponse>('auth/otp/widget/verify', input),

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

  /**
   * Starts a password reset.
   *
   * Always resolves, whether or not the address exists — the server refuses to
   * say, and the screen must not either. Showing "no account with that email"
   * would turn the form into an account-existence oracle.
   */
  forgotPassword: (email: string) =>
    api.post<{ sent: true }>('auth/email/password/forgot', { email }, { anonymous: true }),

  resetPassword: (input: { email: string; code: string; password: string }) =>
    api.post<{ reset: true }>('auth/email/password/reset', input, { anonymous: true }),

  /**
   * Changes the password of a signed-in user.
   *
   * `deviceId` is this device, kept signed in. Every other device is signed
   * out, which is the point of the whole action.
   */
  changePassword: (input: { currentPassword: string; newPassword: string; keepDeviceId: string }) =>
    api.post<{ changed: true }>('auth/password/change', input),

  listSessions: (deviceId: string) =>
    api.get<{ sessions: ActiveSession[] }>(
      `auth/sessions?deviceId=${encodeURIComponent(deviceId)}`,
    ),

  revokeSession: (deviceId: string) =>
    api.delete<{ revoked: number }>(`auth/sessions/${encodeURIComponent(deviceId)}`),

  /**
   * Starts a phone number change.
   *
   * The code goes to the NEW number, not the old one — the commonest reason to
   * change is that the old SIM is gone, and a flow that needs the thing you
   * lost is a flow nobody can finish. The password re-proves the account
   * instead, and is required whenever the account has one.
   */
  requestPhoneChange: (input: { phone: string; channel?: 'whatsapp' | 'sms'; password?: string }) =>
    api.post<OtpRequestResponse>('auth/phone/change/request', input),

  /**
   * Confirms the code and moves the number.
   *
   * `keepDeviceId` is this device. Every other device is signed out, because a
   * number change is a security event whether or not the person meant it as
   * one.
   */
  confirmPhoneChange: (input: { phone: string; code: string; keepDeviceId: string }) =>
    api.post<{ phone: string; user: SessionUser }>('auth/phone/change/verify', input),

  /**
   * Deletes the account.
   *
   * Required by Google Play for any app with accounts, and by DPDP Act 2023.
   * The server anonymises rather than dropping the row — the ledger is
   * append-only and its entries point at this user.
   */
  deleteAccount: (password?: string) =>
    api.post<{ deleted: true }>('auth/account/delete', password ? { password } : {}),
};
