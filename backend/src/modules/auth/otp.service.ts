// OTP issue and verification.
//
// Rate limiting lives in Postgres rather than Redis: the volume is tiny, and a
// limit that survives a process restart is worth more here than microseconds.

import { randomInt } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { config } from '../../config/index.js';
import { withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { OtpChannel, otpProvider } from './otp.provider.js';
import { constantTimeEquals, hmac } from './tokens.js';

/** E.164. Deliberately permissive on country — hosts are India-only, viewers may not be. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function assertValidPhone(phone: string): void {
  if (!E164.test(phone)) {
    throw new AppError('INVALID_PHONE', 'Phone must be in E.164 format, e.g. +919876543210', 422);
  }
}

function generateCode(): string {
  // randomInt, not Math.random: this guards account takeover.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function requestOtp(phoneE164: string, channel: OtpChannel = 'whatsapp') {
  assertValidPhone(phoneE164);

  const code = generateCode();
  const challengeId = uuidv7();

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ count: string }>(
      'SELECT count(*) FROM otp_challenges' +
        " WHERE phone_e164 = $1 AND created_at > now() - interval '1 hour'",
      [phoneE164],
    );
    if (Number(rows[0].count) >= config.otp.perPhonePerHour) {
      throw new AppError('OTP_RATE_LIMITED', 'Too many codes requested. Try again later.', 429);
    }

    // Supersede any live challenge, so an older code cannot still be used.
    await client.query(
      'UPDATE otp_challenges SET consumed_at = now()' +
        ' WHERE phone_e164 = $1 AND consumed_at IS NULL AND expires_at > now()',
      [phoneE164],
    );

    await client.query(
      'INSERT INTO otp_challenges (id, phone_e164, code_hash, channel, max_attempts, expires_at)' +
        " VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' minutes')::interval)",
      [
        challengeId,
        phoneE164,
        hmac(code),
        channel,
        config.otp.maxAttempts,
        String(config.otp.ttlMinutes),
      ],
    );
  });

  // Sent after commit: a provider failure must not leave a phantom challenge,
  // and a challenge row is cheap while an undelivered code is confusing.
  await otpProvider.send(phoneE164, code, channel);

  return {
    challengeId,
    channel,
    expiresInSeconds: config.otp.ttlMinutes * 60,
    // Never leaked in production — the console provider already logged it there.
    ...(config.isProduction ? {} : { devCode: code }),
  };
}

type VerifyOutcome =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'locked' }
  | { kind: 'invalid'; attemptsRemaining: number };

/**
 * Verifies a code and consumes the challenge.
 *
 * The database work returns an OUTCOME and the error is thrown afterwards, on
 * purpose. Throwing inside the transaction would roll it back — including the
 * attempts counter — so every wrong guess would be free and the brute-force
 * limit would silently do nothing. A six-digit code is only a million
 * possibilities; the counter is the whole defence.
 */
export async function verifyOtp(phoneE164: string, code: string): Promise<void> {
  assertValidPhone(phoneE164);

  const outcome = await withTransaction<VerifyOutcome>(async (client) => {
    const { rows } = await client.query<{
      id: string;
      code_hash: string;
      attempts: number;
      max_attempts: number;
    }>(
      'SELECT id, code_hash, attempts, max_attempts FROM otp_challenges' +
        ' WHERE phone_e164 = $1 AND consumed_at IS NULL AND expires_at > now()' +
        ' ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
      [phoneE164],
    );
    const challenge = rows[0];

    if (!challenge) return { kind: 'not_found' };

    if (challenge.attempts >= challenge.max_attempts) {
      await client.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [
        challenge.id,
      ]);
      return { kind: 'locked' };
    }

    const attempts = challenge.attempts + 1;
    await client.query('UPDATE otp_challenges SET attempts = $2 WHERE id = $1', [
      challenge.id,
      attempts,
    ]);

    if (!constantTimeEquals(hmac(code), challenge.code_hash)) {
      return { kind: 'invalid', attemptsRemaining: challenge.max_attempts - attempts };
    }

    await client.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [
      challenge.id,
    ]);
    return { kind: 'ok' };
  });

  switch (outcome.kind) {
    case 'ok':
      return;
    case 'not_found':
      throw new AppError('OTP_NOT_FOUND', 'No active code for this number. Request a new one.', 400);
    case 'locked':
      throw new AppError(
        'OTP_ATTEMPTS_EXCEEDED',
        'Too many wrong attempts. Request a new code.',
        429,
      );
    case 'invalid':
      throw new AppError('OTP_INVALID', 'That code is not correct', 401, {
        attemptsRemaining: outcome.attemptsRemaining,
      });
  }
}
