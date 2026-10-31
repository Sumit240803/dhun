import { conformEvent, createEventQueue, type ClientEvent } from '@/lib/clientEvents';

const at = '2026-10-31T10:00:00.000Z';
const ev = (over: Partial<ClientEvent> = {}): ClientEvent => ({
  level: 'info',
  event: 'cold_start',
  occurredAt: at,
  ...over,
});

describe('conformEvent', () => {
  it('refuses an event name the server would refuse', () => {
    expect(conformEvent(ev({ event: 'has spaces' }))).toBeNull();
    expect(conformEvent(ev({ event: 'x'.repeat(65) }))).toBeNull();
  });

  it('clips strings and keeps only primitive meta, at most 20 keys', () => {
    const meta: Record<string, string | number | boolean | null> = {};
    for (let i = 0; i < 25; i++) meta[`k${i}`] = i;
    meta.long = 'y'.repeat(300);
    meta.nan = Number.NaN;
    const out = conformEvent(
      ev({ message: 'm'.repeat(600), stack: 's'.repeat(3_000), code: 'bad code', traceId: 'ok-trace', meta }),
    )!;
    expect(out.message).toHaveLength(500);
    expect(out.stack).toHaveLength(2_000);
    expect(out.code).toBeUndefined();
    expect(out.traceId).toBe('ok-trace');
    expect(Object.keys(out.meta!)).toHaveLength(20);
    expect(out.meta!.k0).toBe(0);
    expect(out.meta!.nan).toBeUndefined();
  });
});

describe('createEventQueue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends an error within a second and lets a warning wait', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const q = createEventQueue({ send, errorFlushMs: 1_000, flushMs: 10_000 });

    q.push(ev({ level: 'warn', event: 'slow' }));
    await jest.advanceTimersByTimeAsync(1_500);
    expect(send).not.toHaveBeenCalled();

    q.push(ev({ level: 'error', event: 'crash' }));
    await jest.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    // The warning rode along with the error.
    expect(send.mock.calls[0][0].map((e: ClientEvent) => e.event)).toEqual(['slow', 'crash']);
    expect(q.size).toBe(0);
  });

  it('never sends more than a server batch, and drains the rest', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const q = createEventQueue({ send, maxBatch: 20 });
    for (let i = 0; i < 45; i++) q.push(ev({ event: `e${i}` }));
    await jest.advanceTimersByTimeAsync(50);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([20, 20, 5]);
  });

  it('drops a batch that fails to send instead of retrying it', async () => {
    const send = jest.fn().mockRejectedValue(new Error('offline'));
    const q = createEventQueue({ send });
    q.push(ev({ level: 'error', event: 'crash' }));
    await jest.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.size).toBe(0);
  });

  it('keeps the newest when the queue overflows', () => {
    const q = createEventQueue({ send: jest.fn().mockResolvedValue(undefined), maxQueued: 3 });
    for (let i = 0; i < 5; i++) q.push(ev({ event: `e${i}` }));
    expect(q.size).toBe(3);
  });
});
