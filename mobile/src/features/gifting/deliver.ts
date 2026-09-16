// One gift, into both of the room's displays.
//
// Every gift gets a strip. Anything above `basic` also queues a full-screen
// animation. A gift reaches the sender's screen TWICE — from their own send
// response, instantly, and again when the gateway echoes it to the room — and
// both displays dedupe on the transaction id, so it shows once.

import type { GiftView } from '@/api/types';
import { needsQueue, type GiftQueue } from '@/visuals/giftQueue';
import type { GiftStripLanes } from '@/visuals/giftStrips';

export function deliverGift(
  gift: GiftView,
  displays: { strips: GiftStripLanes; animations: GiftQueue },
): void {
  displays.strips.push(gift);

  if (!needsQueue(gift.effect)) return;

  const queued = displays.animations.enqueue({
    id: gift.id,
    giftId: gift.giftId,
    giftName: gift.giftName,
    tier: gift.tier,
    effect: gift.effect,
    animationAsset: gift.animationAsset,
    senderName: gift.senderName,
    hostName: gift.recipientName ?? '',
    quantity: gift.quantity,
  });

  // Starts it if nothing is playing; a no-op while something is.
  if (queued) displays.animations.next();
}
