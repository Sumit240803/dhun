import { GiftQueue, needsQueue, type QueuedGift } from '@/visuals/giftQueue';

// The queue is where a gift storm either looks impressive or looks broken, and
// where a dropped Galaxy becomes a refund request. Tested harder than the
// rendering, because the rendering fails visibly and this fails silently.

let counter = 0;
function gift(tier: number, overrides: Partial<QueuedGift> = {}): QueuedGift {
  counter += 1;
  const effect =
    tier >= 5
      ? 'global_announcement'
      : tier >= 4
        ? 'room_banner'
        : tier >= 3
          ? 'fullscreen'
          : 'basic';
  return {
    id: `txn-${counter}`,
    giftId: `gift-${tier}`,
    giftName: `Tier ${tier}`,
    tier,
    effect,
    animationAsset: `gifts/tier${tier}.json`,
    senderName: 'Sender',
    hostName: 'Host',
    quantity: 1,
    ...overrides,
  };
}

beforeEach(() => {
  counter = 0;
});

describe('what gets queued', () => {
  it('does not queue basic gifts', () => {
    // Tier 1-2 render inline in the message stream. Queueing them would block
    // the screen behind a flood of Roses.
    expect(needsQueue('basic')).toBe(false);
    expect(needsQueue('fullscreen')).toBe(true);
    expect(needsQueue('room_banner')).toBe(true);
    expect(needsQueue('global_announcement')).toBe(true);
  });

  it('rejects a basic gift even if enqueued directly', () => {
    const queue = new GiftQueue();
    expect(queue.enqueue(gift(1))).toBe(false);
    expect(queue.pending).toBe(0);
  });
});

describe('deduplication', () => {
  it('never plays the same transaction twice', () => {
    // The fast path (Redis pub/sub) and the durable path (outbox) can both
    // deliver the same gift. Playing it twice looks like a double charge.
    const queue = new GiftQueue();
    const yacht = gift(3);

    expect(queue.enqueue(yacht)).toBe(true);
    expect(queue.enqueue(yacht)).toBe(false);
    expect(queue.pending).toBe(1);
  });
});

describe('ordering', () => {
  it('plays higher tiers first', () => {
    const queue = new GiftQueue();
    queue.enqueue(gift(3));
    queue.enqueue(gift(5));
    queue.enqueue(gift(4));

    expect(queue.next()?.tier).toBe(5);
    queue.finish();
    expect(queue.next()?.tier).toBe(4);
    queue.finish();
    expect(queue.next()?.tier).toBe(3);
  });

  it('keeps arrival order within a tier', () => {
    const queue = new GiftQueue();
    const first = gift(3);
    const second = gift(3);
    queue.enqueue(first);
    queue.enqueue(second);

    expect(queue.next()?.id).toBe(first.id);
  });

  it('never interrupts what is already playing', () => {
    const queue = new GiftQueue();
    queue.enqueue(gift(3));
    const playing = queue.next();

    // A Galaxy arriving mid-Yacht jumps the QUEUE but does not cut the Yacht
    // off — a truncated animation reads as a bug, not as priority.
    queue.enqueue(gift(5));
    expect(queue.next()).toBeNull();
    expect(queue.current?.id).toBe(playing?.id);

    queue.finish();
    expect(queue.next()?.tier).toBe(5);
  });
});

describe('load shedding', () => {
  it('drops the cheapest gift when full, not the newest', () => {
    const queue = new GiftQueue();
    // Fill with eight Tier 3s.
    for (let i = 0; i < 8; i++) queue.enqueue(gift(3));
    expect(queue.pending).toBe(8);

    // A Galaxy arrives. It MUST get in — dropping a ₹15,000 gift because two
    // hundred Roses queued ahead of it is a refund request and a lost whale.
    const galaxy = gift(5);
    expect(queue.enqueue(galaxy)).toBe(true);
    expect(queue.pending).toBe(8);
    expect(queue.next()?.id).toBe(galaxy.id);
  });

  it('rejects a cheap gift when the queue is full of expensive ones', () => {
    const queue = new GiftQueue();
    for (let i = 0; i < 8; i++) queue.enqueue(gift(5));

    // Correct behaviour: a Scooter cannot displace a Rocket.
    expect(queue.enqueue(gift(3))).toBe(false);
    expect(queue.pending).toBe(8);
  });

  it('caps the queue so animations never fall far behind live', () => {
    const queue = new GiftQueue();
    for (let i = 0; i < 50; i++) queue.enqueue(gift(3));

    // At ~3s each, eight is already 24 seconds behind. An animation for a gift
    // sent half a minute ago confuses rather than celebrates.
    expect(queue.pending).toBe(8);
  });
});

describe('leaving a room', () => {
  it('abandons the queue', () => {
    const queue = new GiftQueue();
    queue.enqueue(gift(3));
    queue.enqueue(gift(4));
    queue.next();

    queue.clear();

    // A gift from the room you just left must not follow you into the next one.
    expect(queue.pending).toBe(0);
    expect(queue.current).toBeNull();
  });
});
