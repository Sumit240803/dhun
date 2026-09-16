// Idempotency keys for gift taps — `IntentKeys`, with a gift's identity as the
// signature. See lib/intentKeys.ts for the rule and why it matters.

import type { GiftQuantity } from '@/api/types';
import { outcomeUnknown } from '@/lib/errors';
import { IntentKeys } from '@/lib/intentKeys';

// Re-exported: the gifting tests pin this rule where it was first needed.
export { outcomeUnknown };

export interface GiftIntent {
  roomId: string;
  recipientId: string;
  giftId: string;
  quantity: GiftQuantity;
}

function signature(intent: GiftIntent): string {
  return `${intent.roomId}|${intent.recipientId}|${intent.giftId}|${intent.quantity}`;
}

export class SendIntents {
  private readonly keys: IntentKeys;

  constructor(newKey: () => string) {
    this.keys = new IntentKeys(newKey);
  }

  begin(intent: GiftIntent): string {
    return this.keys.begin(signature(intent));
  }

  settle(intent: GiftIntent, key: string, error: unknown | null): void {
    this.keys.settle(signature(intent), key, error);
  }
}
