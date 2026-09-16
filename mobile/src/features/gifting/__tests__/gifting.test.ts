import { ApiError } from '@/api/client';
import type { GiftView } from '@/api/types';
import { deliverGift } from '@/features/gifting/deliver';
import { giftRecipients } from '@/features/gifting/recipients';
import { outcomeUnknown, SendIntents, type GiftIntent } from '@/features/gifting/sendIntent';
import { GiftQueue } from '@/visuals/giftQueue';
import { GiftStripLanes } from '@/visuals/giftStrips';

const rose: GiftIntent = { roomId: 'room', recipientId: 'host', giftId: 'rose', quantity: 1 };

function intents() {
  let n = 0;
  return new SendIntents(() => `key-${++n}`);
}

describe('idempotency keys for gift taps', () => {
  it('gives every tap its own key — a combo is many gifts, not one retried', () => {
    const sends = intents();
    // Overlapping taps: both are in flight at once.
    const first = sends.begin(rose);
    const second = sends.begin(rose);
    expect(first).not.toBe(second);
  });

  it('reuses the key when retrying a send that may have been charged', () => {
    const sends = intents();
    const key = sends.begin(rose);
    sends.settle(rose, key, new ApiError('NETWORK_ERROR', 'offline', 0));

    expect(sends.begin(rose)).toBe(key);
  });

  it('reuses it once — the retry after that is a new gift', () => {
    const sends = intents();
    const key = sends.begin(rose);
    sends.settle(rose, key, new ApiError('TIMEOUT', 'slow', 0));

    const retry = sends.begin(rose);
    sends.settle(rose, retry, null);

    expect(sends.begin(rose)).not.toBe(key);
  });

  it('mints a fresh key after a definite refusal, because nothing was charged', () => {
    const sends = intents();
    const key = sends.begin(rose);
    sends.settle(rose, key, new ApiError('INSUFFICIENT_BALANCE', 'no', 402));

    expect(sends.begin(rose)).not.toBe(key);
  });

  it('does not carry an unknown send over to a DIFFERENT gift', () => {
    // Reusing it would be refused as a key reused for another identity.
    const sends = intents();
    const key = sends.begin(rose);
    sends.settle(rose, key, new ApiError('NETWORK_ERROR', 'offline', 0));

    expect(sends.begin({ ...rose, quantity: 10 })).not.toBe(key);
  });

  it('treats server errors and in-flight conflicts as unknown, and 4xx as known', () => {
    expect(outcomeUnknown(new ApiError('INTERNAL_ERROR', 'x', 500))).toBe(true);
    expect(outcomeUnknown(new ApiError('REQUEST_IN_PROGRESS', 'x', 409))).toBe(true);
    expect(outcomeUnknown(new Error('boom'))).toBe(true);
    expect(outcomeUnknown(new ApiError('GIFT_PRICE_CHANGED', 'x', 409))).toBe(false);
    expect(outcomeUnknown(new ApiError('ROOM_ENDED', 'x', 410))).toBe(false);
  });
});

describe('gift recipients', () => {
  const seats = [
    { seatIndex: 2, userId: 'rohan', displayName: 'Rohan' },
    { seatIndex: 0, userId: 'host', displayName: 'Host' },
    { seatIndex: 1, userId: 'meera', displayName: null },
  ];

  it('puts the host first, then seats in order', () => {
    const list = giftRecipients({ hostId: 'host', hostName: 'Host', seats, meId: 'viewer' });
    expect(list.map((r) => r.userId)).toEqual(['host', 'meera', 'rohan']);
    expect(list[0].isHost).toBe(true);
    expect(list[1].name).toBe('—');
  });

  it('never offers yourself — the server refuses it', () => {
    const asHost = giftRecipients({ hostId: 'host', hostName: 'Host', seats, meId: 'host' });
    expect(asHost.map((r) => r.userId)).toEqual(['meera', 'rohan']);

    const asSeated = giftRecipients({ hostId: 'host', hostName: 'Host', seats, meId: 'rohan' });
    expect(asSeated.map((r) => r.userId)).toEqual(['host', 'meera']);
  });

  it('is empty for the host of a room with nobody on stage', () => {
    expect(giftRecipients({ hostId: 'host', hostName: 'Host', seats: [], meId: 'host' })).toEqual(
      [],
    );
  });
});

describe('delivering a gift to the room', () => {
  function view(overrides: Partial<GiftView> = {}): GiftView {
    return {
      id: 'txn-1',
      senderId: 'asha',
      senderName: 'Asha',
      senderAvatar: null,
      senderFrame: null,
      recipientId: 'host',
      recipientName: 'Host',
      giftId: 'yacht',
      giftName: 'Yacht',
      giftIcon: null,
      tier: 3,
      effect: 'fullscreen',
      animationAsset: 'gifts/yacht/anim.v1.json',
      coinPrice: 15_500,
      quantity: 1,
      ...overrides,
    };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows the sender their own gift once, though it arrives twice', () => {
    // Once from the send response, once echoed by the gateway.
    const strips = new GiftStripLanes();
    const animations = new GiftQueue();

    deliverGift(view(), { strips, animations });
    deliverGift(view(), { strips, animations });

    expect(strips.getSnapshot()).toHaveLength(1);
    expect(strips.getSnapshot()[0].count).toBe(1);
    expect(animations.current?.id).toBe('txn-1');
    expect(animations.pending).toBe(0);
  });

  it('plays full-screen gifts, and only strips a basic one', () => {
    const strips = new GiftStripLanes();
    const animations = new GiftQueue();

    deliverGift(
      view({ id: 'rose', giftId: 'rose', tier: 1, effect: 'basic', animationAsset: null }),
      {
        strips,
        animations,
      },
    );

    expect(strips.getSnapshot()).toHaveLength(1);
    expect(animations.current).toBeNull();
  });
});
