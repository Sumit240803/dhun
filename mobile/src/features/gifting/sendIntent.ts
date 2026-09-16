// Which idempotency key a gift tap uses.
//
// Two mistakes are possible here, and they cost money in opposite directions:
//
//   · REUSING a key too eagerly. Combo taps overlap — the second lands while
//     the first is still in flight — and if both carried one key the server
//     would replay the first and the second gift would silently never happen.
//
//   · MINTING a fresh key too eagerly. A send whose response was lost to a
//     tunnel may well have been charged. Retrying it under a new key charges
//     it a second time.
//
// So: every tap gets a fresh key, EXCEPT the one tap that retries a send whose
// outcome is unknown. That tap — same room, same recipient, same gift, same
// quantity — reuses the key, and the server either completes it or replays it.
// Nothing else ever does.

import { ApiError } from '@/api/client';
import { ApiErrorCode, type GiftQuantity } from '@/api/types';

export interface GiftIntent {
  roomId: string;
  recipientId: string;
  giftId: string;
  quantity: GiftQuantity;
}

function signature(intent: GiftIntent): string {
  return `${intent.roomId}|${intent.recipientId}|${intent.giftId}|${intent.quantity}`;
}

/**
 * Whether a failed send might nonetheless have been charged.
 *
 * A 4xx is the server saying no, and nothing moved. No response at all, a
 * timeout, a 5xx or a still-in-flight 409 all leave the question open.
 */
export function outcomeUnknown(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.code === ApiErrorCode.NETWORK_ERROR || error.code === ApiErrorCode.TIMEOUT) return true;
  if (error.code === ApiErrorCode.REQUEST_IN_PROGRESS) return true;
  return error.status >= 500;
}

export class SendIntents {
  /** The one send that may be retried under its old key. */
  private retry: { signature: string; key: string } | null = null;

  constructor(private readonly newKey: () => string) {}

  /** The key for a tap about to be sent. */
  begin(intent: GiftIntent): string {
    const sig = signature(intent);
    if (this.retry?.signature === sig) {
      const { key } = this.retry;
      this.retry = null;
      return key;
    }
    return this.newKey();
  }

  /** The send finished. Only an unknown outcome is kept for a retry. */
  settle(intent: GiftIntent, key: string, error: unknown | null): void {
    if (error !== null && outcomeUnknown(error)) {
      this.retry = { signature: signature(intent), key };
      return;
    }
    if (this.retry?.key === key) this.retry = null;
  }
}
