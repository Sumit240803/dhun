// MSG91 OTP widget, wrapped.
//
// The SDK is a NATIVE module and it reaches for `NativeModules.BiometricAuth`
// at import time, logging an error when the bridge is missing. A development
// build made before this package was installed has no such bridge, so it is
// loaded LAZILY and behind a try — importing it eagerly would put a red error
// in front of every user of an older build, on a screen that does not even use
// the widget.
//
// Everything here is optional by construction. The widget is a delivery
// mechanism; the app's own OTP flow stays in place and is what runs whenever
// this is unavailable, unconfigured, or switched off from the server.

import type { OtpWidgetConfig } from '@/api/types';

interface Sdk {
  initializeWidget(widgetId: string, tokenAuth: string): Promise<unknown>;
  sendOTP(body: { identifier: string }): Promise<unknown>;
  verifyOTP(body: { reqId: string; otp: string }): Promise<unknown>;
}

let sdk: Sdk | null = null;
let initialisedFor: string | null = null;

/**
 * Loads the native SDK, or returns null when it is not in this build.
 *
 * Null is a normal outcome, not an error: the app falls back to its own OTP
 * path, which is fully implemented. Treating a missing native module as fatal
 * would make the widget a hard dependency, which is exactly what the fallback
 * exists to avoid.
 */
function loadSdk(): Sdk | null {
  if (sdk !== null) return sdk;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('@msg91comm/sendotp-react-native') as { OTPWidget?: Sdk };
    sdk = module.OTPWidget ?? null;
  } catch {
    sdk = null;
  }

  return sdk;
}

/** Whether widget sign-in can actually run: configured, enabled, AND present. */
export function isWidgetAvailable(config: OtpWidgetConfig | undefined): boolean {
  return config?.enabled === true && loadSdk() !== null;
}

/**
 * Sends a code and returns the request id the verify step needs.
 *
 * Re-initialises whenever the credentials change, which is what makes a
 * server-side rotation take effect without an app release — the whole reason
 * the token is served from config rather than bundled.
 */
export async function sendWidgetOtp(config: OtpWidgetConfig, identifier: string): Promise<string> {
  const widget = loadSdk();
  if (!widget) throw new Error('OTP widget is not available in this build');

  const fingerprint = `${config.widgetId}:${config.tokenAuth}`;
  if (initialisedFor !== fingerprint) {
    await widget.initializeWidget(config.widgetId, config.tokenAuth);
    initialisedFor = fingerprint;
  }

  // MSG91 wants the country code with no '+'.
  const response = await widget.sendOTP({ identifier: identifier.replace(/^\+/, '') });
  const reqId = readString(response, 'message');

  if (reqId === null) throw new Error('OTP widget did not return a request id');
  return reqId;
}

/**
 * Checks the code with MSG91 and returns the ACCESS TOKEN.
 *
 * That token is not proof of anything on its own — it arrives from the client
 * and a client can send anything. It becomes trustworthy only when the server
 * confirms it with the account authkey, which is what
 * POST /v1/auth/otp/widget/verify does.
 */
export async function verifyWidgetOtp(reqId: string, code: string): Promise<string> {
  const widget = loadSdk();
  if (!widget) throw new Error('OTP widget is not available in this build');

  const response = await widget.verifyOTP({ reqId, otp: code });
  const accessToken = readString(response, 'message');

  if (accessToken === null) throw new Error('OTP widget did not return an access token');
  return accessToken;
}

/** The SDK types its responses as `any`; nothing from it is trusted unchecked. */
function readString(response: unknown, key: string): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const value = (response as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
