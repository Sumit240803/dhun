// Payment verification, one implementation per channel.
//
// Verification answers exactly one question: did this person really pay, and how
// much? Everything downstream — the purchases row, the ledger legs, the balance —
// trusts the answer, so nothing here may be permissive by default.

import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config/index.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';

export interface VerificationResult {
  /** The provider's own transaction id. Carries a UNIQUE constraint, so a captured receipt cannot be replayed. */
  providerTxnId: string;
  /** What the provider says was charged, when it tells us. */
  amountPaise?: number;
  raw: unknown;
}

export interface IapVerifier {
  readonly provider: string;
  verify(input: { productId: string; purchaseToken: string }): Promise<VerificationResult>;
}

/**
 * Development and test only.
 *
 * Accepts a well-formed token without calling Google, so the whole purchase path
 * is exercisable before the Play developer account exists. Refuses to run in
 * production — a stub that silently credits real coins is the worst possible
 * failure in this system.
 */
class StubIapVerifier implements IapVerifier {
  readonly provider = 'google_play';

  async verify(input: { productId: string; purchaseToken: string }): Promise<VerificationResult> {
    if (config.isProduction) {
      throw new Error('StubIapVerifier must never be used in production');
    }
    if (!/^stub-[a-zA-Z0-9._-]{8,}$/.test(input.purchaseToken)) {
      throw new AppError(
        'RECEIPT_INVALID',
        'Stub verifier expects a token shaped like stub-xxxxxxxx',
        402,
      );
    }
    logger.warn('IAP receipt accepted by STUB verifier — not a real purchase', {
      product_id: input.productId,
    });
    return { providerTxnId: input.purchaseToken, raw: { stub: true, ...input } };
  }
}

/**
 * The real thing. Blocked on Track 0 (Play developer account + service account).
 *
 * When implemented it calls purchases.products.get on the Play Developer API and
 * must check: purchaseState is purchased, the order is not already consumed, the
 * packageName matches ours, and the productId matches the pack requested. The
 * orderId becomes providerTxnId.
 */
class GooglePlayVerifier implements IapVerifier {
  readonly provider = 'google_play';

  async verify(_input: { productId: string; purchaseToken: string }): Promise<VerificationResult> {
    if (!config.iap.playPackageName || !config.iap.playServiceAccountJson) {
      throw new Error('Google Play verification is not configured');
    }
    throw new Error('Google Play verifier not implemented — see M3 spike in docs/build-plan.md');
  }
}

export const iapVerifier: IapVerifier =
  config.iap.provider === 'google_play' ? new GooglePlayVerifier() : new StubIapVerifier();

/**
 * Razorpay web checkout.
 *
 * Fully implemented, because the signature is verifiable offline: Razorpay signs
 * `order_id|payment_id` with the account's key secret. No network call, so no
 * spike is needed to trust this path.
 */
export function verifyRazorpaySignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): VerificationResult {
  const secret = config.razorpay.keySecret;
  if (!secret) throw new Error('RAZORPAY_KEY_SECRET is not set');

  const expected = createHmac('sha256', secret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  const ok = a.length === b.length && timingSafeEqual(a, b);

  if (!ok) {
    throw new AppError('SIGNATURE_INVALID', 'Payment signature did not verify', 402, {
      orderId: input.orderId,
    });
  }

  return {
    providerTxnId: input.paymentId,
    raw: { orderId: input.orderId, paymentId: input.paymentId },
  };
}
