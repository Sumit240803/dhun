// PUBLIC API of the auth module. Other modules import ONLY from here.
//
// Owns identity: users, devices, sessions, and scoped role assignments. It is
// the sole authority on "who is this?" and "may they?".

export { buildAuthRouter } from './auth.routes.js';

export { createGuest, verifyPhoneAndSignIn, getSessionUser, updateProfile } from './auth.service.js';
export type { DeviceInfo, SessionUser } from './auth.service.js';

export { verifyAccessToken, rotateRefreshToken, revokeRefreshTokens } from './tokens.js';
export type { AccessClaims, TokenPair } from './tokens.js';

export { hasRole, assertRole, getRoles, grantRole, revokeRole } from './permissions.js';
export type { RoleGrant, ScopeType } from './permissions.js';

export { requestOtp, verifyOtp } from './otp.service.js';
export type { OtpChannel } from './otp.provider.js';
