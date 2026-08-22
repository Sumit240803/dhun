// OTP delivery, behind an interface.
//
// WhatsApp is the primary channel and SMS the fallback: WhatsApp has better
// delivery on low-end Android, near-universal reach in India, and — unlike SMS —
// sits outside TRAI's TCCCPR, so it needs no DLT registration.
//
// SMS still requires DLT: a Principal Entity registration, an approved 6-character
// header, and every template pre-approved. MSG91 assists with that but cannot do
// it for you; the registration is in your company's name.

import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

export type OtpChannel = 'whatsapp' | 'sms';

export interface OtpProvider {
  readonly name: string;
  send(phoneE164: string, code: string, channel: OtpChannel): Promise<void>;
}

/**
 * Development provider. Writes the code to the log instead of sending it, so the
 * whole flow is testable long before DLT paperwork clears.
 *
 * Refuses to run in production — otherwise a misconfigured deploy would silently
 * accept signups while never delivering a code.
 */
class ConsoleOtpProvider implements OtpProvider {
  readonly name = 'console';

  async send(phoneE164: string, code: string, channel: OtpChannel): Promise<void> {
    if (config.isProduction) {
      throw new Error('ConsoleOtpProvider must never be used in production');
    }
    logger.warn('OTP (development only — not actually sent)', {
      phone: phoneE164,
      code,
      channel,
    });
  }
}

/**
 * Real sender. Blocked on Track 0 (DLT registration + template approval).
 *
 * Deliberately throws rather than silently no-opping: an auth flow that appears
 * to work but delivers nothing is far worse than one that fails loudly.
 */
class Msg91OtpProvider implements OtpProvider {
  readonly name = 'msg91';

  async send(_phoneE164: string, _code: string, _channel: OtpChannel): Promise<void> {
    if (!config.msg91.authKey || !config.msg91.templateId) {
      throw new Error('MSG91 is not configured — set MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
    }
    // M2 follow-up, once DLT registration completes:
    //   POST https://control.msg91.com/api/v5/flow/
    //   { template_id, sender, recipients: [{ mobiles, code }] }
    // The template must match the DLT-approved wording exactly, variable for
    // variable, or the carrier drops the message without an error.
    throw new Error('MSG91 provider not implemented — blocked on DLT registration');
  }
}

export const otpProvider: OtpProvider =
  config.otp.provider === 'msg91' ? new Msg91OtpProvider() : new ConsoleOtpProvider();
