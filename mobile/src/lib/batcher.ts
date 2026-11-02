// A small outbound batcher, shared by the error reports (clientEvents.ts) and
// the analytics events (analyticsTransport.ts).
//
// Pure — the sender and the timers are injected — so the rules are tested
// without a network. The rules, each for a reason:
//
//   · An urgent item flushes soon; everything else waits and rides along.
//   · A batch that fails to send is DROPPED, never requeued. A reporter that
//     retries into an outage makes the outage worse, and a report about the
//     reporter failing would loop.
//   · The queue is bounded. Past the cap the OLDEST go — during an incident
//     the most recent item is the one that explains it.
//   · A full batch goes at once rather than waiting for the timer.

export interface BatcherOptions<T> {
  send: (items: T[]) => Promise<void>;
  maxBatch: number;
  maxQueued: number;
  /** Delay before sending an ordinary item. */
  flushMs: number;
  /** Delay before sending an urgent one. */
  urgentMs?: number;
  isUrgent?: (item: T) => boolean;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export interface Batcher<T> {
  push(item: T): void;
  flush(): Promise<void>;
  readonly size: number;
}

export function createBatcher<T>(options: BatcherOptions<T>): Batcher<T> {
  const { maxBatch, maxQueued, flushMs } = options;
  const urgentMs = options.urgentMs ?? flushMs;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;

  let queue: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerDueAt = Infinity;
  let sending: Promise<void> | undefined;

  const schedule = (afterMs: number) => {
    const dueAt = Date.now() + afterMs;
    if (timer && dueAt >= timerDueAt) return;
    if (timer) clearTimer(timer);
    timerDueAt = dueAt;
    timer = setTimer(() => {
      timer = undefined;
      timerDueAt = Infinity;
      void flush();
    }, afterMs);
  };

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimer(timer);
      timer = undefined;
      timerDueAt = Infinity;
    }
    if (sending) await sending;
    if (queue.length === 0) return;

    const batch = queue.slice(0, maxBatch);
    queue = queue.slice(maxBatch);

    sending = options
      .send(batch)
      .catch(() => undefined)
      .finally(() => {
        sending = undefined;
      });
    await sending;

    if (queue.length > 0) schedule(0);
  };

  return {
    push(item) {
      if (queue.length >= maxQueued) queue.shift();
      queue.push(item);
      if (queue.length >= maxBatch) schedule(0);
      else schedule(options.isUrgent?.(item) ? urgentMs : flushMs);
    },
    flush,
    get size() {
      return queue.length;
    },
  };
}
