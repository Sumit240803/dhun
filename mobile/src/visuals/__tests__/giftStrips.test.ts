import { GiftStripLanes, type GiftStripEvent } from '@/visuals/giftStrips';

// The lane logic is where a busy room either looks neat or looks broken, and
// it fails silently — a stuck lane or a combo that spawns thirty strips does
// not throw. So it is tested here, without a renderer.

let counter = 0;
let clock = 0;

function send(overrides: Partial<GiftStripEvent> = {}): GiftStripEvent {
  counter += 1;
  return {
    id: `txn-${counter}`,
    senderId: 'sender-a',
    senderName: 'Asha',
    senderAvatar: null,
    senderFrame: null,
    recipientId: 'host',
    recipientName: 'Host',
    giftId: 'rose',
    giftName: 'Rose',
    giftIcon: null,
    tier: 1,
    coinPrice: 45,
    quantity: 1,
    ...overrides,
  };
}

function lanes(options: ConstructorParameters<typeof GiftStripLanes>[0] = {}) {
  return new GiftStripLanes({ lanes: 3, holdMs: 3000, now: () => clock, ...options });
}

beforeEach(() => {
  counter = 0;
  clock = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('lanes', () => {
  it('fills from the top down', () => {
    const strips = lanes();
    strips.push(send({ senderId: 'a' }));
    strips.push(send({ senderId: 'b' }));
    strips.push(send({ senderId: 'c' }));

    expect(strips.getSnapshot().map((s) => s.lane)).toEqual([0, 1, 2]);
  });

  it('queues once every lane is busy, and shows it when one frees', () => {
    const strips = lanes();
    for (const id of ['a', 'b', 'c']) strips.push(send({ senderId: id }));

    expect(strips.push(send({ senderId: 'd' }))).toBe('queued');
    expect(strips.getSnapshot()).toHaveLength(3);

    strips.release(strips.getSnapshot()[1].key);

    const shown = strips.getSnapshot().map((s) => s.event.senderId);
    expect(shown).toContain('d');
  });

  it('refills the TOPMOST free lane, not the one that happened to empty', () => {
    // Otherwise the stack grows gaps at the top and reads out of order.
    const strips = lanes();
    for (const id of ['a', 'b', 'c']) strips.push(send({ senderId: id }));
    strips.push(send({ senderId: 'd' }));

    const [top, middle] = strips.getSnapshot();
    strips.release(middle.key); // d takes lane 1
    strips.release(top.key); // lane 0 is now free and nothing is queued

    strips.push(send({ senderId: 'e' }));
    const e = strips.getSnapshot().find((s) => s.event.senderId === 'e');
    expect(e?.lane).toBe(0);
  });
});

describe('combos', () => {
  it('merges repeated sends into one strip that counts up', () => {
    // Thirty taps on Rose is one strip reading x30, not thirty strips filling
    // every lane and the queue behind them.
    const strips = lanes();
    strips.push(send());
    expect(strips.push(send())).toBe('combined');
    expect(strips.push(send({ quantity: 10 }))).toBe('combined');

    const [strip] = strips.getSnapshot();
    expect(strips.getSnapshot()).toHaveLength(1);
    expect(strip.count).toBe(12);
    expect(strip.combo).toBe(2);
  });

  it('keeps the same key, so the view animates a bump rather than a new entrance', () => {
    const strips = lanes();
    strips.push(send());
    const before = strips.getSnapshot()[0].key;
    strips.push(send());
    expect(strips.getSnapshot()[0].key).toBe(before);
  });

  it('treats a different gift from the same sender as a separate strip', () => {
    const strips = lanes();
    strips.push(send({ giftId: 'rose' }));
    strips.push(send({ giftId: 'teddy', giftName: 'Teddy' }));
    expect(strips.getSnapshot()).toHaveLength(2);
  });

  it('treats the same gift to a different recipient as a separate strip', () => {
    // In a party room, Rose to the host and Rose to seat 3 are two things.
    const strips = lanes();
    strips.push(send({ recipientId: 'host' }));
    strips.push(send({ recipientId: 'seat-3' }));
    expect(strips.getSnapshot()).toHaveLength(2);
  });

  it('merges into a strip that is still waiting in the queue', () => {
    const strips = lanes();
    for (const id of ['a', 'b', 'c']) strips.push(send({ senderId: id, giftId: 'other' }));

    strips.push(send({ senderId: 'z' }));
    expect(strips.push(send({ senderId: 'z' }))).toBe('combined');

    strips.release(strips.getSnapshot()[0].key);
    const z = strips.getSnapshot().find((s) => s.event.senderId === 'z');
    expect(z?.count).toBe(2);
  });

  it('extends the hold while the combo continues', () => {
    const strips = lanes();
    strips.push(send());

    jest.advanceTimersByTime(2500);
    strips.push(send()); // resets the hold

    jest.advanceTimersByTime(2500);
    expect(strips.getSnapshot()[0].leaving).toBe(false);

    jest.advanceTimersByTime(600);
    expect(strips.getSnapshot()[0].leaving).toBe(true);
  });

  it('stops extending after the lifetime ceiling, and starts a fresh strip', () => {
    // One person tapping continuously must not hold a lane for a whole
    // broadcast.
    const strips = lanes({ maxLifetimeMs: 10_000 });
    strips.push(send());

    clock = 11_000;
    expect(strips.push(send())).toBe('shown');
    expect(strips.getSnapshot()).toHaveLength(2);
  });

  it('does not merge into a strip that is already leaving', () => {
    const strips = lanes();
    strips.push(send());
    jest.advanceTimersByTime(3100);
    expect(strips.getSnapshot()[0].leaving).toBe(true);

    expect(strips.push(send())).toBe('shown');
  });
});

describe('the queue', () => {
  it('lets an expensive gift go ahead of cheaper ones', () => {
    const strips = lanes();
    for (const id of ['a', 'b', 'c']) strips.push(send({ senderId: id }));

    strips.push(send({ senderId: 'rose-1' }));
    strips.push(send({ senderId: 'rose-2' }));
    strips.push(
      send({ senderId: 'whale', giftId: 'yacht', giftName: 'Yacht', tier: 3, coinPrice: 15_500 }),
    );

    strips.release(strips.getSnapshot()[0].key);
    const next = strips.getSnapshot().find((s) => s.lane === 0);
    expect(next?.event.senderId).toBe('whale');
  });

  it('values a combo by its total, not its unit price', () => {
    // Rose x999 is worth more than a single Teddy, and should rank that way.
    const strips = lanes();
    for (const id of ['a', 'b', 'c']) strips.push(send({ senderId: id }));

    strips.push(send({ senderId: 'teddy', giftId: 'teddy', coinPrice: 999, quantity: 1 }));
    strips.push(send({ senderId: 'roses', quantity: 999 }));

    strips.release(strips.getSnapshot()[0].key);
    expect(strips.getSnapshot().find((s) => s.lane === 0)?.event.senderId).toBe('roses');
  });

  it('when full, sheds the cheapest — never an expensive newcomer', () => {
    const strips = lanes({ maxQueue: 2 });
    for (const id of ['a', 'b', 'c']) strips.push(send({ senderId: id }));

    strips.push(send({ senderId: 'rose-1' }));
    strips.push(send({ senderId: 'rose-2' }));
    expect(strips.push(send({ senderId: 'whale', giftId: 'yacht', coinPrice: 15_500 }))).toBe(
      'queued',
    );

    // And a cheap newcomer into a full queue is the one that goes.
    expect(strips.push(send({ senderId: 'rose-3' }))).toBe('dropped');
  });

  it('ignores a delivery it has already seen', () => {
    const strips = lanes();
    const gift = send();
    strips.push(gift);
    expect(strips.push(gift)).toBe('duplicate');
    expect(strips.getSnapshot()[0].count).toBe(1);
  });
});

describe('nothing gets stuck', () => {
  it('releases a lane whose view never reported its exit', () => {
    // An unmounted strip or a dropped animation callback would otherwise hold
    // the lane forever and silently cut the room to two lanes.
    const strips = lanes({ exitTimeoutMs: 1500 });
    strips.push(send());

    jest.advanceTimersByTime(3000); // hold ends
    expect(strips.getSnapshot()[0].leaving).toBe(true);

    jest.advanceTimersByTime(1500); // no release() from the view
    expect(strips.getSnapshot()).toHaveLength(0);
  });

  it('ignores a late release for a lane that has already moved on', () => {
    const strips = lanes({ exitTimeoutMs: 1500 });
    for (const id of ['a', 'b', 'c']) strips.push(send({ senderId: id }));
    strips.push(send({ senderId: 'd' }));

    const topKey = strips.getSnapshot()[0].key;
    jest.advanceTimersByTime(4500); // all three leave and are force-released

    // d now occupies lane 0. A stale callback for the old key must not evict it.
    strips.release(topKey);
    expect(strips.getSnapshot().some((s) => s.event.senderId === 'd')).toBe(true);
  });

  it('keeps the same snapshot reference until something changes', () => {
    // useSyncExternalStore re-renders forever on a fresh array each read.
    const strips = lanes();
    strips.push(send());
    expect(strips.getSnapshot()).toBe(strips.getSnapshot());
  });
});
