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
  /** Money needs a confirmed phone or email. The client offers the verify flow. */
  CONTACT_UNVERIFIED: 'CONTACT_UNVERIFIED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  EMAIL_ALREADY_VERIFIED: 'EMAIL_ALREADY_VERIFIED',
  PASSWORD_TOO_SHORT: 'PASSWORD_TOO_SHORT',
  PASSWORD_TOO_LONG: 'PASSWORD_TOO_LONG',
  /** Deleting an account with a password set needs that password. */
  PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
  /** A phone-only account has nothing to change. Offer to set one instead. */
  NO_PASSWORD: 'NO_PASSWORD',
  /** The new number belongs to someone else. Nothing was sent to it. */
  PHONE_TAKEN: 'PHONE_TAKEN',
  /** The "new" number is the one already on the account. */
  PHONE_UNCHANGED: 'PHONE_UNCHANGED',
  INVALID_PHONE: 'INVALID_PHONE',

  // rooms
  /** The host already has a live room. Carries `roomId` so the app can open it. */
  ALREADY_LIVE: 'ALREADY_LIVE',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  /** 410. The broadcast is over — go back to the feed, not to a retry. */
  ROOM_ENDED: 'ROOM_ENDED',
  /** The host kicked you. Rejoining is refused, not merely disconnected. */
  ROOM_BANNED: 'ROOM_BANNED',
  NOT_ROOM_HOST: 'NOT_ROOM_HOST',
  SEAT_TAKEN: 'SEAT_TAKEN',
  SEAT_RESERVED: 'SEAT_RESERVED',
  SEAT_OUT_OF_RANGE: 'SEAT_OUT_OF_RANGE',
  ALREADY_SEATED: 'ALREADY_SEATED',
  NOT_SEATED: 'NOT_SEATED',
  NOT_A_PARTY_ROOM: 'NOT_A_PARTY_ROOM',
  HOST_SEAT_FIXED: 'HOST_SEAT_FIXED',
  CANNOT_KICK_HOST: 'CANNOT_KICK_HOST',
  /** The media server is unreachable. A provider outage, not the user's doing. */
  RTC_UNAVAILABLE: 'RTC_UNAVAILABLE',
  CODE_INVALID: 'CODE_INVALID',
  CODE_NOT_FOUND: 'CODE_NOT_FOUND',
  CODE_ATTEMPTS_EXCEEDED: 'CODE_ATTEMPTS_EXCEEDED',
  EMAIL_RATE_LIMITED: 'EMAIL_RATE_LIMITED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',

  // otp
  OTP_INVALID: 'OTP_INVALID',
  OTP_NOT_FOUND: 'OTP_NOT_FOUND',
  OTP_ATTEMPTS_EXCEEDED: 'OTP_ATTEMPTS_EXCEEDED',
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  /** The widget token could not be confirmed with MSG91. Fall back to our OTP. */
  WIDGET_TOKEN_INVALID: 'WIDGET_TOKEN_INVALID',
  /** MSG91 was unreachable. A provider outage, not the user getting it wrong. */
  VERIFICATION_UNAVAILABLE: 'VERIFICATION_UNAVAILABLE',

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

  // rewards
  WELCOME_ALREADY_USED_ON_DEVICE: 'WELCOME_ALREADY_USED_ON_DEVICE',
  REWARD_UNAVAILABLE: 'REWARD_UNAVAILABLE',
  REFERRAL_CODE_INVALID: 'REFERRAL_CODE_INVALID',
  REFERRAL_SELF: 'REFERRAL_SELF',
  REFERRAL_ALREADY_SET: 'REFERRAL_ALREADY_SET',
  REFERRAL_WINDOW_CLOSED: 'REFERRAL_WINDOW_CLOSED',
  REFERRAL_NOT_ALLOWED: 'REFERRAL_NOT_ALLOWED',

  // agency
  ALREADY_IN_AGENCY: 'ALREADY_IN_AGENCY',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  CANNOT_JOIN_SELF: 'CANNOT_JOIN_SELF',
  REQUEST_ALREADY_PENDING: 'REQUEST_ALREADY_PENDING',
  INVITE_NOT_MATCHED: 'INVITE_NOT_MATCHED',
  HOST_IN_AGENCY: 'HOST_IN_AGENCY',
  NOT_AN_AGENT: 'NOT_AN_AGENT',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  REQUEST_CLOSED: 'REQUEST_CLOSED',
  AGENCY_UNAVAILABLE: 'AGENCY_UNAVAILABLE',
  NOT_IN_AGENCY: 'NOT_IN_AGENCY',
  QUIT_ALREADY_PENDING: 'QUIT_ALREADY_PENDING',
  /** details.nextAllowedAt says when the host may apply again. */
  QUIT_COOLDOWN: 'QUIT_COOLDOWN',
  NOT_AGENCY_OWNER: 'NOT_AGENCY_OWNER',
  QUIT_DECISION_CLOSED: 'QUIT_DECISION_CLOSED',

  // agency coin channel
  /** 402. The agency has not bought that many coins. */
  TRANSFER_TOO_LARGE: 'TRANSFER_TOO_LARGE',
  TRANSFER_DAILY_LIMIT: 'TRANSFER_DAILY_LIMIT',
  RECIPIENT_DAILY_LIMIT: 'RECIPIENT_DAILY_LIMIT',
  RECIPIENT_NOT_FOUND: 'RECIPIENT_NOT_FOUND',
  TRANSFER_TO_SELF: 'TRANSFER_TO_SELF',
  COIN_TRADING_DISABLED: 'COIN_TRADING_DISABLED',

  // cosmetics
  COSMETIC_NOT_FOUND: 'COSMETIC_NOT_FOUND',
  /** Repriced while the store was open. Refetch; nothing was charged. */
  COSMETIC_PRICE_CHANGED: 'COSMETIC_PRICE_CHANGED',
  COSMETIC_NOT_OWNED: 'COSMETIC_NOT_OWNED',
  /** 410. Owned, but lapsed — offer the renewal. */
  COSMETIC_EXPIRED: 'COSMETIC_EXPIRED',

  // gifting
  GIFT_TO_SELF: 'GIFT_TO_SELF',
  GIFT_NOT_FOUND: 'GIFT_NOT_FOUND',
  /** The catalog was repriced while the sheet was open. Refetch it; nothing was charged. */
  GIFT_PRICE_CHANGED: 'GIFT_PRICE_CHANGED',
  /** The recipient left the stage — or blocked the sender, deliberately the same code. */
  RECIPIENT_NOT_IN_ROOM: 'RECIPIENT_NOT_IN_ROOM',

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

/**
 * A device with a live session.
 *
 * Only devices with an unrevoked refresh token appear — a device with no live
 * token is not a session, and listing it would make "sign out" look like it did
 * nothing.
 */
export interface ActiveSession {
  deviceId: string;
  platform: string;
  appVersion: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** This device. It never offers to sign itself out from the list. */
  current: boolean;
}

export interface SessionUser {
  id: string;
  status: UserStatus;
  phone: string | null;
  /** Present for an email account. Phone-only accounts have none. */
  email: string | null;
  /**
   * Address confirmed.
   *
   * Deliberately deferrable — an unverified account works normally. What it
   * gates is MONEY: the server refuses a purchase with CONTACT_UNVERIFIED.
   */
  emailVerified: boolean;
  displayName: string | null;
  /**
   * Display name AND date of birth are both set.
   *
   * The client cannot work this out on its own — it never sees the date of
   * birth — and without it someone who quit mid-signup came back
   * authenticated, went straight to the feed, and was never asked again.
   */
  profileComplete: boolean;
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

// --- rooms ------------------------------------------------------------------

export type RoomTag = 'singing' | 'dancing' | 'chatting' | 'gaming' | 'friends' | 'esports';
export type FeedCategory = 'explore' | 'party' | 'following';

export interface FeedRoom {
  id: string;
  hostId: string;
  hostName: string;
  title: string;
  tag: RoomTag;
  /** ISO 3166-1 alpha-2, rendered as a flag. */
  country: string;
  /** Null while cold start hides counts — the card then shows "Live" alone. */
  viewers: number | null;
  coverUrl: string | null;
  /** Non-null ONLY for a party room. Its presence is what tells the two apart. */
  seatCount: number | null;
  seatCapacity: number | null;
  video: boolean;
  trending: boolean;
}

/**
 * A credential to join one media room, minted by our server.
 *
 * Short-lived on purpose — it is redeemed within seconds of being issued, and
 * a long-lived one is a standing invitation to a room the user may since have
 * been banned from. The client refuses to start a join it knows has expired.
 */
export interface RtcJoinToken {
  token: string;
  /** Served, not bundled, so the media server can move without an app release. */
  url: string;
  /** Unix seconds. */
  expiresAt: number;
}

export interface LiveRoom {
  id: string;
  hostId: string;
  hostName: string | null;
  title: string;
  tag: RoomTag;
  country: string;
  coverUrl: string | null;
  video: boolean;
  /** Non-null ONLY for a party room. Its presence is what tells the two apart. */
  seatCapacity: number | null;
  seatsTaken: number;
  viewers: number;
  startedAt: string;
}

export interface RoomSeat {
  seatIndex: number;
  userId: string;
  displayName: string | null;
  /** Muted BY THE HOST — not the same as someone muting themselves. */
  muted: boolean;
  takenAt: string;
  look: UserLook;
}

export interface JoinedRoom {
  room: LiveRoom;
  seats: RoomSeat[];
  rtc: RtcJoinToken;
  /**
   * Whether this user may speak.
   *
   * Decided by the SERVER from the seat table — the client cannot ask for it
   * and must not infer it. Mirrored inside the token's grants, so a client that
   * ignored this would still be refused by the media server.
   */
  canPublish: boolean;
}

// --- messages ---------------------------------------------------------------

export type ThreadFilter = 'all' | 'official' | 'unread' | 'groups';

export interface MessageThread {
  id: string;
  title: string;
  preview: string;
  /** ISO 8601. Formatted on the client — the server knows neither timezone nor locale. */
  updatedAt: string;
  unread: number;
  official: boolean;
  group: boolean;
  avatarUrl: string | null;
  accent: 'money' | 'security' | 'system' | 'person';
}

// --- profile ----------------------------------------------------------------

export interface ProfileSummary {
  /** The short number a user reads out to be found. Never the internal uuid. */
  publicId: string;
  friends: number;
  following: number;
  followers: number;
  newVisitors: number;
  vipTier: 'silver' | 'gold' | 'diamond' | null;
  userLevel: number;
  hostLevel: number | null;
  points: number;
  /** PHONE verified. Payout KYC — PAN plus face — is a stricter, separate check. */
  verified: boolean;
  /** What the owner is wearing, so the Me screen draws them as others see them. */
  look: UserLook;
}

export const REPORT_REASONS = [
  'nudity',
  'harassment',
  'hate',
  'violence',
  'self_harm',
  'minor',
  'scam',
  'spam',
  'impersonation',
  'illegal',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export interface PublicProfile {
  userId: string;
  publicId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  country: string;
  userLevel: number;
  followers: number;
  following: number;
  isFollowing: boolean;
  /** Their live room, if broadcasting right now. */
  liveRoomId: string | null;
  look: UserLook;
}

export interface Visitor {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  visitedAt: string;
  /** Whether you already follow them. Drives the button state without a second call. */
  following: boolean;
}

export interface ThreadMessage {
  id: string;
  body: string;
  createdAt: string;
  /** null for a platform message. */
  senderId: string | null;
  senderName: string | null;
  mine: boolean;
}

// --- server-driven config ---------------------------------------------------

export interface OtpWidgetConfig {
  enabled: boolean;
  widgetId: string;
  /**
   * PUBLIC by construction — it ships to the app and an APK is readable.
   * Served from config rather than bundled so it can be rotated or revoked
   * without a release. The account authkey is a different credential and
   * never leaves the server.
   */
  tokenAuth: string;
}

export interface ClientConfig {
  /** Merged over the local defaults. Unknown keys are ignored by older builds. */
  flags: Record<string, boolean>;
  otpWidget: OtpWidgetConfig;
  /** Below this the app blocks with an update prompt it cannot dismiss. */
  minSupportedVersion: string;
  /** Below this the app offers an update the user may decline. */
  latestVersion: string;
  storeUrl: string;
  coldStart: ColdStartConfig;
}

/** growth-plan-v1's cold-start rules, as the server has them switched. */
export interface ColdStartConfig {
  maxFeedRooms: number | null;
  hideViewerCounts: boolean;
  /** 'HH:MM', IST. */
  peakStartIst: string;
  peakEndIst: string;
  dropNewUsersIntoRoom: boolean;
}

// --- rewards -----------------------------------------------------------------

export interface RewardsStatus {
  welcome: { coins: number; claimed: boolean; available: boolean };
  checkin: {
    ladder: number[];
    claimedToday: boolean;
    /** Today's ladder day if claimed, otherwise the day a claim now would be. */
    streakDay: number;
  };
  watch: { coins: number; minutes: number; dailyCap: number; earnedToday: number };
  referral: {
    /** The caller's public ID — what a friend types. */
    code: string;
    coins: number;
    minPurchasePaise: number;
    invited: number;
    rewarded: number;
    canEnterCode: boolean;
    referredBy: string | null;
  };
}

// --- discover ----------------------------------------------------------------

export interface PersonResult {
  userId: string;
  publicId: string;
  displayName: string;
  avatarUrl: string | null;
  userLevel: number;
  liveRoomId: string | null;
  isFollowing: boolean;
  look: UserLook;
}

export interface RoomResult {
  id: string;
  title: string;
  hostId: string;
  hostName: string;
  viewers: number | null;
  party: boolean;
}

export interface AppBanner {
  id: string;
  title: string;
  subtitle: string;
  endsAt: string | null;
  action: 'ranking' | 'rewards' | 'topup' | 'none';
  /** The server names a theme; the CLIENT owns the palette. */
  theme: 'gold' | 'rose' | 'violet';
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
  effect: GiftEffect;
  /** Static picture, every gift. A CDN path — resolve with `assetUrl`. */
  iconAsset: string | null;
  /** Full-screen Lottie. Null for `basic` gifts, which only ever show as a strip. */
  animationAsset: string | null;
}

export type GiftEffect = 'basic' | 'fullscreen' | 'room_banner' | 'global_announcement';

/** The combo multipliers — the only quantities the server accepts. */
export const GIFT_QUANTITIES = [1, 10, 99, 520, 999] as const;
export type GiftQuantity = (typeof GIFT_QUANTITIES)[number];

/**
 * A gift as a room is told about it — over the gateway, and in the sender's own
 * send response. Mirrors `GiftView` in backend/src/gateway/protocol.ts.
 */
export interface GiftView {
  /** The ledger transaction id. Dedupe on it: the sender sees it twice. */
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  senderFrame: UserLook['frame'];
  recipientId: string;
  recipientName: string | null;
  giftId: string;
  giftName: string;
  giftIcon: string | null;
  tier: number;
  effect: GiftEffect;
  animationAsset: string | null;
  coinPrice: number;
  quantity: number;
}

export interface SendGiftResult {
  gift: GiftView;
  coinsSpent: number;
  balance: { coins: number };
  /** True when this key had already been sent — the retry of a lost response. */
  replayed: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  coins: number;
}

// --- cosmetics ---------------------------------------------------------------

/** The four kinds M7 sells. VIP and super message are not worn and not sold yet. */
export type CosmeticKind = 'frame' | 'chat_bubble' | 'nickname_color' | 'entry_effect';

/** Server style data carries both palettes; the app draws whichever `MODE` names. */
export interface Themed<T> {
  light: T;
  dark: T;
}

export interface FrameStyle {
  /** The ring drawn in code while the art loads, or instead of it. */
  ring: string;
}
export interface BubbleStyle {
  background: string;
  border: string;
  text: string;
}
export interface NameColorStyle {
  color: string;
}
export interface EntryStyle {
  accent: string;
}

/**
 * How someone appears: what they are wearing right now. Mirrors `UserLook` in
 * backend/src/shared/cosmeticStyle.ts. Every part is independently null.
 */
export interface UserLook {
  frame: { asset: string | null; style: Themed<FrameStyle> } | null;
  bubble: Themed<BubbleStyle> | null;
  nameColor: Themed<NameColorStyle> | null;
  entry: { asset: string | null; style: Themed<EntryStyle> } | null;
}

export const EMPTY_LOOK: UserLook = { frame: null, bubble: null, nameColor: null, entry: null };

/** Someone wearing an entry effect arrived in a room. Nobody else is announced. */
export interface EntryView {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  look: UserLook;
}

export type Cosmetic = {
  id: string;
  name: string;
  gemPrice: number;
  durationDays: number | null;
  freeAtUserLevel: number | null;
  asset: string | null;
} & (
  | { kind: 'frame'; style: Themed<FrameStyle> }
  | { kind: 'chat_bubble'; style: Themed<BubbleStyle> }
  | { kind: 'nickname_color'; style: Themed<NameColorStyle> }
  | { kind: 'entry_effect'; style: Themed<EntryStyle> }
);

export interface CosmeticCatalog {
  cosmetics: Cosmetic[];
  /** The live coins→gems terms. Never guessed on the client. */
  conversion: { coinToGemRateBp: number; minimumCoins: number };
}

export interface OwnedCosmetic {
  cosmeticId: string;
  kind: CosmeticKind;
  name: string;
  expiresAt: string;
  /** Still within its time. A lapsed item stays listed so it can be renewed. */
  active: boolean;
  equipped: boolean;
}

export interface CosmeticPurchaseResult {
  item: OwnedCosmetic;
  gemsSpent: number;
  balance: { gems: number };
  replayed: boolean;
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

// ── Agency (M12) ────────────────────────────────────────────────────────────

export interface AgencyRef {
  id: string;
  publicId: number;
  name: string;
  isHouse: boolean;
}

export interface AgencyPerson {
  publicId: number;
  displayName: string | null;
}

export interface AgencyMembership {
  assignmentId: string;
  joinedAt: string;
  agency: AgencyRef;
  agent: AgencyPerson & { id: string };
  owner: AgencyPerson & { userId: string };
}

export interface AgentSeat {
  id: string;
  publicId: number;
  canManageAgents: boolean;
  isOwner: boolean;
  agency: AgencyRef;
}

export type QuitStatus = 'pending' | 'approved' | 'rejected' | 'auto_left' | 'direct' | 'void';

export interface QuitRequest {
  id: string;
  status: QuitStatus;
  reason: string;
  createdAt: string;
  rejectedAt: string | null;
  resolvedAt: string | null;
  autoLeaveAt: string | null;
  approvableUntil: string | null;
  /** When the host may apply to leave again. */
  nextApplyAt: string;
  host: AgencyPerson & { userId: string };
}

export interface MyAgency {
  membership: AgencyMembership | null;
  seat: AgentSeat | null;
  quitRequest: QuitRequest | null;
}

export interface JoinRequest {
  id: string;
  direction: 'host_applied' | 'agent_invited';
  status: string;
  message: string | null;
  createdAt: string;
  expiresAt: string;
  host: AgencyPerson & { userId: string };
  agent: AgencyPerson & { id: string };
  agency: AgencyRef;
}

export interface TransferCaps {
  perTransferMaxCoins: number;
  perRecipientDailyCoins: number;
  perAgencyDailyCoins: number;
  perAgencyDailyCount: number;
}

export interface AgencyInventory {
  agency: { id: string; publicId: number; name: string };
  coins: number;
  coinTradingEnabled: boolean;
  caps: TransferCaps;
  isNewAgency: boolean;
  usedToday: { coins: number; count: number };
}

export interface CoinTransfer {
  id: string;
  coins: number;
  note: string | null;
  createdAt: string;
  agency: { id: string; publicId: number; name: string };
  recipient: { userId: string; publicId: number; displayName: string | null };
}
