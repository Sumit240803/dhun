// Server-side verification of an MSG91 OTP widget access token.
//
// THE SECURITY BOUNDARY OF THE WHOLE WIDGET FLOW LIVES HERE.
//
// With the widget, the app talks to MSG91 directly: it sends the code and the
// user types it back, all client-side. What reaches our API afterwards is just
// a string the client claims MSG91 gave it — and a client can send anything.
// This function is what turns that claim into a fact, by asking MSG91 with the
// account AUTHKEY, which never leaves this process.
//
// Two credentials, two trust levels, and the distinction matters:
//
//   · tokenAuth — shipped in the app, extractable from any APK, and therefore
//     PUBLIC. If it leaks, someone can send OTPs and spend your balance. They
//     cannot authenticate as anyone.
//   · authkey   — server only. If this leaks, verification can be forged and
//     any phone number can be claimed. It must never be served to a client,
//     logged, or returned in an error.
//
// ⚠️ THE REQUEST SHAPE BELOW IS UNCONFIRMED. MSG91's public docs render the
// endpoint client-side and did not yield a spec; the panel's Server-Side
// Integration section has the authoritative version. Both the URL and the body
// are config-driven for that reason. What is NOT left to configuration is the
// failure behaviour: anything other than an unambiguous success is a rejection.

import { config } from '../../config/index.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';

/** Confirm against the panel before going live. One constant to change. */
const VERIFY_URL = 'https://control.msg91.com/api/v5/widget/verifyAccessToken';

/** A slow provider must not hold a request open indefinitely. */
const TIMEOUT_MS = 8_000;

interface VerifyResponse {
  type?: string;
  message?: string;
  /** The verified phone or email, depending on how the widget is configured. */
  identifier?: string;
  [key: string]: unknown;
}

/**
 * Returns the identifier MSG91 confirms was verified.
 *
 * FAILS CLOSED, deliberately and in every direction: a network error, a
 * timeout, a non-200, an unparseable body, a success flag that is not exactly
 * what we expect, or a missing identifier all raise. The one outcome that
 * returns is an explicit success carrying an identifier.
 *
 * That property is what makes the unconfirmed request shape above safe to ship.
 * If the body is wrong, MSG91 rejects it and nobody signs in — which is a
 * broken flow, not a security hole. The opposite default would let a malformed
 * request that happens to 200 authenticate anyone.
 */
export async function verifyWidgetAccessToken(accessToken: string): Promise<string> {
  if (!config.msg91.authKey) {
    throw new Error('MSG91_AUTH_KEY is not set — widget tokens cannot be verified');
  }

  let response: Response;

  try {
    response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authkey: config.msg91.authKey,
        'access-token': accessToken,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Logged as a provider outage rather than a user error: nobody can sign in
    // through the widget right now, and that is a page-worthy fact.
    logger.error('MSG91 widget verification unreachable', { err });
    throw new AppError(
      'VERIFICATION_UNAVAILABLE',
      'Could not verify that code right now. Try again.',
      503,
    );
  }

  let body: VerifyResponse;

  try {
    body = (await response.json()) as VerifyResponse;
  } catch {
    logger.error('MSG91 widget verification returned an unreadable body', {
      status: response.status,
    });
    throw rejected();
  }

  if (!response.ok || body.type !== 'success') {
    // The provider's message is NOT passed through to the user. It is written
    // for a developer, may name internal fields, and is exactly the kind of
    // string that leaks implementation detail into a login screen.
    logger.warn('MSG91 widget verification rejected', {
      status: response.status,
      type: body.type,
    });
    throw rejected();
  }

  const identifier = typeof body.message === 'string' ? body.message : body.identifier;

  if (typeof identifier !== 'string' || identifier.length === 0) {
    // A success with nothing to identify is not a success. Refusing here is
    // what stops a shape change at MSG91 from silently signing in a blank user.
    logger.error('MSG91 widget verification succeeded without an identifier', { body });
    throw rejected();
  }

  return normaliseIdentifier(identifier);
}

/**
 * MSG91 returns a phone as digits with the country code and no '+'.
 * Everything downstream assumes E.164, so it is restored here rather than in
 * five call sites that would each get it slightly differently.
 */
function normaliseIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return trimmed.startsWith('+') ? trimmed : `+${trimmed.replace(/\D/g, '')}`;
}

/** One shared rejection, so no failure path leaks which check it failed. */
function rejected(): AppError {
  return new AppError('WIDGET_TOKEN_INVALID', 'That verification could not be confirmed', 401);
}
