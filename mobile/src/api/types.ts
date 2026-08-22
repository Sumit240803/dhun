// API contract.
//
// Mirrors the backend's error envelope and response shapes. Deliberately NOT a
// shared package yet: the tooling cost (npm workspaces, Metro watchFolders, TS
// path mapping) is real, and the only thing genuinely worth sharing today is a
// list of string constants. Revisit when the analytics event taxonomy lands —
// that is a contract worth enforcing in one place.

/** Every failure from the API has this shape. Switch on `code`, never on status or message. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    trace_id?: string;
  };
}

export interface FieldIssue {
  field: string;
  code: string;
  message: string;
}

/**
 * Error codes the app branches on.
 *
 * Anything not listed here falls through to the generic handler and shows the
 * server's message — which is safe, because the backend sanitises 5xx text.
 */
export const ApiErrorCode = {
  // auth
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  /** The session was ended for security — a refresh token was replayed. Sign out fully. */
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  REGISTRATION_REQUIRED: 'REGISTRATION_REQUIRED',
  /** No date of birth on file. Open the date picker rather than showing a dead end. */
  DOB_REQUIRED: 'DOB_REQUIRED',
  UNDERAGE: 'UNDERAGE',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',

  // otp
  OTP_INVALID: 'OTP_INVALID',
  OTP_NOT_FOUND: 'OTP_NOT_FOUND',
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',

  // money
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  CONVERSION_TOO_SMALL: 'CONVERSION_TOO_SMALL',
  PACK_ALREADY_PURCHASED: 'PACK_ALREADY_PURCHASED',
  RECEIPT_INVALID: 'RECEIPT_INVALID',
  RECEIPT_ALREADY_USED: 'RECEIPT_ALREADY_USED',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  REQUEST_IN_PROGRESS: 'REQUEST_IN_PROGRESS',
  TXN_TYPE_INACTIVE: 'TXN_TYPE_INACTIVE',

  // transport
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** Client-side only: the request never reached the server. */
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type ApiErrorCodeValue = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

// --- auth -------------------------------------------------------------------

export type UserStatus = 'guest' | 'active' | 'suspended' | 'banned';

export interface RoleGrant {
  roleCode: string;
  scopeType: 'global' | 'room' | 'agency';
  scopeId: string | null;
}

export interface SessionUser {
  id: string;
  status: UserStatus;
  phone: string | null;
  displayName: string | null;
  roles: RoleGrant[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface SessionResponse extends TokenPair {
  user: SessionUser;
  isNewUser?: boolean;
}

export interface DevicePayload {
  deviceId: string;
  platform: 'android' | 'ios' | 'web';
  appVersion?: string;
  pushToken?: string;
}

export interface OtpRequestResponse {
  challengeId: string;
  channel: 'whatsapp' | 'sms';
  expiresInSeconds: number;
  /** Present only outside production, so the flow is testable before DLT clears. */
  devCode?: string;
}

// --- wallet -----------------------------------------------------------------

export interface Wallet {
  coins: number;
  gems: number;
  userLevel: number;
  lifetimePurchasedCoins: number;
}

export interface CoinPack {
  id: string;
  name: string;
  pricePaise: number;
  coins: number;
  gems: number;
  badge: string | null;
  playProductId: string | null;
  lifetimeOnce: boolean;
}

export interface Gift {
  id: string;
  name: string;
  tier: number;
  coinPrice: number;
  payoutRateBp: number;
  effect: 'basic' | 'fullscreen' | 'room_banner' | 'global_announcement';
  animationAsset: string | null;
}

export interface Cosmetic {
  id: string;
  name: string;
  kind: string;
  gemPrice: number;
  durationDays: number | null;
  freeAtUserLevel: number | null;
}

export interface WalletTransaction {
  id: string;
  type: string;
  createdAt: string;
  coins: number;
  gems: number;
  points: number;
}

export interface PurchaseResult {
  purchaseId: string;
  txnId: string;
  replayed: boolean;
  coinsGranted: number;
  gemsGranted: number;
  balances: { coins: number; gems: number };
  userLevel: number;
}
