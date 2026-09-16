// Which idempotency key a money request uses.
//
// Two mistakes are possible, and they cost money in opposite directions:
//
//   · REUSING a key too eagerly. Two genuine requests overlap — a combo's
//     second tap lands while the first is in flight — and one key would make
//     the server replay the first, so the second silently never happens.
//
//   · MINTING a fresh key too eagerly. A request whose response was lost to a
//     tunnel may well have gone through. Retrying it under a new key charges
//     it a second time.
//
// So: every request gets a fresh key, EXCEPT the one that retries a request
// whose outcome is unknown. That retry — the same intent, described by the same
// signature — reuses the key, and the server either completes it or replays
// it. Nothing else ever does.

import { outcomeUnknown } from '@/lib/errors';

export class IntentKeys {
  /** The one request that may be retried under its old key. */
  private retry: { signature: string; key: string } | null = null;

  constructor(private readonly newKey: () => string) {}

  /** The key for a request about to be sent. */
  begin(signature: string): string {
    if (this.retry?.signature === signature) {
      const { key } = this.retry;
      this.retry = null;
      return key;
    }
    return this.newKey();
  }

  /** The request finished. Only an unknown outcome is kept for a retry. */
  settle(signature: string, key: string, error: unknown | null): void {
    if (error !== null && outcomeUnknown(error)) {
      this.retry = { signature, key };
      return;
    }
    if (this.retry?.key === key) this.retry = null;
  }
}
