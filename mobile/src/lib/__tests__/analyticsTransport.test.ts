import { createHttpAnalyticsTransport, toWire } from '@/lib/analyticsTransport';

const stamped = (extra: Record<string, unknown> = {}) => ({
  user_id: 'u-1',
  session_id: 'sess-1',
  device_id: 'dev-1',
  timestamp: '2026-11-02T10:00:00.000Z',
  app_version: '1.0.0',
  platform: 'android',
  country: 'IN',
  locale: 'hi',
  user_level: 3,
  is_paying: false,
  ...extra,
});

describe('toWire', () => {
  it('moves the common stamp out of props and never sends a user id', () => {
    const wire = toWire('gift_sent', stamped({ gift_id: 'rose', quantity: 10 }));
    expect(wire).toEqual({
      event: 'gift_sent',
      occurredAt: '2026-11-02T10:00:00.000Z',
      sessionId: 'sess-1',
      props: { gift_id: 'rose', quantity: 10, locale: 'hi', user_level: 3 },
    });
    expect(JSON.stringify(wire)).not.toContain('u-1');
  });

  it('keeps primitives only, clipped, at most 30 keys', () => {
    const extra: Record<string, unknown> = {
      nested: { a: 1 },
      list: [1, 2],
      nan: Number.NaN,
      long: 'x'.repeat(300),
    };
    for (let i = 0; i < 40; i++) extra[`k${i}`] = i;
    const { props } = toWire('feed_viewed', stamped(extra));
    expect(props.nested).toBeUndefined();
    expect(props.list).toBeUndefined();
    expect(props.nan).toBeUndefined();
    expect((props.long as string).length).toBe(200);
    // 30 kept, plus locale and level.
    expect(Object.keys(props)).toHaveLength(32);
  });
});

describe('createHttpAnalyticsTransport', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits, then sends one batch with the device id', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const t = createHttpAnalyticsTransport({ send, deviceId: () => 'dev-1', flushMs: 15_000 });

    t.track('app_opened', stamped());
    t.track('feed_viewed', stamped());
    await jest.advanceTimersByTimeAsync(14_000);
    expect(send).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].deviceId).toBe('dev-1');
    expect(send.mock.calls[0][0].events.map((e: { event: string }) => e.event)).toEqual([
      'app_opened',
      'feed_viewed',
    ]);
  });

  it('sends a full batch of fifty at once', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const t = createHttpAnalyticsTransport({ send, deviceId: () => undefined });
    for (let i = 0; i < 50; i++) t.track('room_card_tapped', stamped());
    await jest.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].events).toHaveLength(50);
  });

  it('flush sends what is queued now, and a failed batch is dropped', async () => {
    const send = jest.fn().mockRejectedValue(new Error('offline'));
    const t = createHttpAnalyticsTransport({ send, deviceId: () => undefined });
    t.track('app_opened', stamped());
    await t.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(t.size).toBe(0);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
