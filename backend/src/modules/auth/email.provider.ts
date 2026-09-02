// Email delivery, behind an interface — the same shape as the OTP provider.
//
// Nothing is wired to a real sender yet, and that is a Track 0 item rather than
// a code one: transactional email needs a verified sending domain with SPF,
// DKIM and DMARC, which needs the domain, which needs the entity. Sending from
// an unauthenticated domain lands in spam, and a verification email that lands
// in spam is worse than no email auth at all.
//
// When it is time: SES or Resend, one class implementing this interface, one
// line in the factory below. Nothing else changes.

import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

export type EmailPurpose = 'verify' | 'reset';

export interface EmailProvider {
  readonly name: string;
  sendCode(email: string, code: string, purpose: EmailPurpose): Promise<void>;
}

/**
 * Development provider. Writes the code to the log instead of sending it.
 *
 * Refuses to run in production, exactly like the console OTP provider — a
 * misconfigured deploy that silently accepts signups while delivering nothing
 * is the failure this prevents.
 */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async sendCode(email: string, code: string, purpose: EmailPurpose): Promise<void> {
    if (config.isProduction) {
      throw new Error('ConsoleEmailProvider must never be used in production');
    }
    logger.warn('email code (development only — not actually sent)', { email, code, purpose });
  }
}

/** Placeholder for the real sender. Loud, so a half-configured deploy fails fast. */
class UnconfiguredEmailProvider implements EmailProvider {
  readonly name = 'unconfigured';

  async sendCode(): Promise<void> {
    throw new Error(
      'No email provider is configured — set EMAIL_PROVIDER, or a verification email will never arrive',
    );
  }
}

export function emailProvider(): EmailProvider {
  return config.email.provider === 'console'
    ? new ConsoleEmailProvider()
    : new UnconfiguredEmailProvider();
}
