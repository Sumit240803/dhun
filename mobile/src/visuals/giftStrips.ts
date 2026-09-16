// Gift strips — the small "X sent Rose x10" banners that slide across a room.
//
// Not the same thing as the gift QUEUE (giftQueue.ts). That one plays a single
// full-screen animation at a time. Strips are the opposite shape: several at
// once, every send gets one, and they are read at a glance rather than watched.
// The naming is deliberate too — "room banner" is already the Tier 4 gift
// effect, and two things with one name is how a bug report gets misread.
//
// Pure and framework-free, like the queue, because this is where a gift storm
// either looks neat or looks broken, and that is worth testing without a
// renderer.
//
// ── The four rules ──────────────────────────────────────────────────────────
//
//   1. LANES, top to bottom. A new strip takes the highest free lane, so the
//      stack reads downward and never leaves a gap at the top.
//
//   2. COMBOS MERGE. Someone tapping Rose thirty times is one strip counting up
//      to x30, not thirty strips. Without this a single enthusiastic sender
//      fills every lane and the queue, and nobody else's gift is seen at all.
//
//   3. VALUE ORDERS THE QUEUE. When every lane is busy, a Yacht waiting behind
//      a row of Roses goes first. Same principle as the animation queue: the
//      expensive gift is the one a sender notices going unacknowledged.
//
//   4. NOTHING GETS STUCK. A strip whose view never reports that it finished
//      leaving — unmounted mid-animation, a dropped frame — is released anyway.
//      One stuck lane would silently cut the room's capacity by a third.

export interface GiftStripEvent {
  /** The ledger transaction id. A replayed delivery must never show twice. */
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  /** The sender's equipped avatar frame, when they have one. */
  senderFrame: string | null;
  recipientId: string;
  recipientName: string | null;
  giftId: string;
  giftName: string;
  giftIcon: string | null;
  tier: number;
  coinPrice: number;
  /** The combo multiplier on THIS send — x1, x10, x99, x520, x999. */
  quantity: number;
}

export interface GiftStrip {
  /** Stable for the life of one strip. A merged combo keeps its key. */
  key: string;
  lane: number;
  event: GiftStripEvent;
  /** Accumulated quantity across merged sends. What the "x30" shows. */
  count: number;
  /** How many sends have merged in. The view pulses when it changes. */
  combo: number;
  /** Past its hold. The view animates out, then calls `release`. */
  leaving: boolean;
}

export type PushResult = 'shown' | 'combined' | 'queued' | 'dropped' | 'duplicate';

interface Options {
  lanes?: number;
  /** How long a strip holds once it has arrived. Reset by every combo. */
  holdMs?: number;
  /**
   * The longest one strip may live, however many combos extend it.
   *
   * Without a ceiling, one person tapping continuously holds a lane for the
   * whole broadcast. Past this, the next send starts a fresh strip instead —
   * which also re-announces the running total to people who just arrived.
   */
  maxLifetimeMs?: number;
  /** How long to wait for the view to report its exit before releasing anyway. */
  exitTimeoutMs?: number;
  maxQueue?: number;
  now?: () => number;
}

interface Slot extends GiftStrip {
  comboKey: string;
  bornAt: number;
  holdTimer: ReturnType<typeof setTimeout> | null;
  exitTimer: ReturnType<typeof setTimeout> | null;
}

/** Same sender, same gift, same recipient. Anything else is a different strip. */
function comboKeyOf(event: GiftStripEvent): string {
  return `${event.senderId}:${event.giftId}:${event.recipientId}`;
}

function valueOf(event: GiftStripEvent): number {
  return event.coinPrice * event.quantity;
}

export class GiftStripLanes {
  private readonly laneCount: number;
  private readonly holdMs: number;
  private readonly maxLifetimeMs: number;
  private readonly exitTimeoutMs: number;
  private readonly maxQueue: number;
  private readonly now: () => number;

  private lanes: (Slot | null)[];
  private queue: GiftStripEvent[] = [];
  private seen = new Set<string>();
  private listeners = new Set<() => void>();
  private snapshot: readonly GiftStrip[] = [];
  private nextKey = 0;

  constructor(options: Options = {}) {
    this.laneCount = options.lanes ?? 3;
    this.holdMs = options.holdMs ?? 3_000;
    this.maxLifetimeMs = options.maxLifetimeMs ?? 10_000;
    this.exitTimeoutMs = options.exitTimeoutMs ?? 1_500;
    this.maxQueue = options.maxQueue ?? 10;
    this.now = options.now ?? Date.now;
    this.lanes = Array.from({ length: this.laneCount }, () => null);
  }

  // ── Subscription, shaped for useSyncExternalStore ────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The same array reference until something changes, as useSyncExternalStore requires. */
  getSnapshot = (): readonly GiftStrip[] => this.snapshot;

  private emit(): void {
    this.snapshot = this.lanes
      .filter((slot): slot is Slot => slot !== null)
      .map(({ key, lane, event, count, combo, leaving }) => ({
        key,
        lane,
        event,
        count,
        combo,
        leaving,
      }));
    for (const listener of this.listeners) listener();
  }

  // ── Input ────────────────────────────────────────────────────────────────

  push(event: GiftStripEvent): PushResult {
    // A websocket replay, or two delivery paths racing. Showing it twice
    // would make one gift look like two, which to a host is a discrepancy
    // with their earnings.
    if (this.seen.has(event.id)) return 'duplicate';
    this.seen.add(event.id);
    if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));

    const comboKey = comboKeyOf(event);

    // Rule 2, on screen: merge into the strip already showing this combo.
    const active = this.lanes.find(
      (slot): slot is Slot =>
        slot !== null &&
        slot.comboKey === comboKey &&
        !slot.leaving &&
        this.now() - slot.bornAt < this.maxLifetimeMs,
    );
    if (active) {
      active.count += event.quantity;
      active.combo += 1;
      // The latest send's details win — a renamed sender or a newly equipped
      // frame should show, not the one from ten seconds ago.
      active.event = { ...event, quantity: active.count };
      this.startHold(active);
      this.emit();
      return 'combined';
    }

    // Rule 2, in the queue: a combo that has not reached the screen yet still
    // counts as one waiting strip, not thirty.
    const queued = this.queue.find((waiting) => comboKeyOf(waiting) === comboKey);
    if (queued) {
      queued.quantity += event.quantity;
      this.sortQueue();
      return 'combined';
    }

    const free = this.lanes.indexOf(null);
    if (free !== -1) {
      this.place(event, free);
      this.emit();
      return 'shown';
    }

    // Rule 3: every lane busy. Queue by value, and when full, shed the
    // cheapest — never the newcomer just because it arrived last.
    this.queue.push({ ...event });
    this.sortQueue();
    if (this.queue.length > this.maxQueue) {
      const dropped = this.queue.pop()!;
      return dropped.id === event.id ? 'dropped' : 'queued';
    }
    return 'queued';
  }

  /**
   * Called by the view once its exit animation has finished.
   *
   * Idempotent: the exit timeout may have released the lane already, and a
   * late callback from the view must not release whatever took its place.
   */
  release(key: string): void {
    const index = this.lanes.findIndex((slot) => slot?.key === key);
    if (index === -1) return;

    this.clearTimers(this.lanes[index]!);
    this.lanes[index] = null;

    const next = this.queue.shift();
    if (next) {
      // Rule 1: the topmost free lane, which may be above the one just freed.
      this.place(next, this.lanes.indexOf(null));
    }

    this.emit();
  }

  /** Stops every timer. Called when the room screen goes away. */
  clear(): void {
    for (const slot of this.lanes) if (slot) this.clearTimers(slot);
    this.lanes = Array.from({ length: this.laneCount }, () => null);
    this.queue = [];
    this.emit();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private place(event: GiftStripEvent, lane: number): void {
    const slot: Slot = {
      key: `strip-${(this.nextKey += 1)}`,
      lane,
      event,
      count: event.quantity,
      combo: 0,
      leaving: false,
      comboKey: comboKeyOf(event),
      bornAt: this.now(),
      holdTimer: null,
      exitTimer: null,
    };
    this.lanes[lane] = slot;
    this.startHold(slot);
  }

  private startHold(slot: Slot): void {
    if (slot.holdTimer) clearTimeout(slot.holdTimer);

    slot.holdTimer = setTimeout(() => {
      slot.holdTimer = null;
      slot.leaving = true;
      this.emit();

      // Rule 4. The view normally calls `release` itself when its exit
      // animation ends; this only fires if it never does.
      slot.exitTimer = setTimeout(() => this.release(slot.key), this.exitTimeoutMs);
    }, this.holdMs);
  }

  private clearTimers(slot: Slot): void {
    if (slot.holdTimer) clearTimeout(slot.holdTimer);
    if (slot.exitTimer) clearTimeout(slot.exitTimer);
    slot.holdTimer = null;
    slot.exitTimer = null;
  }

  private sortQueue(): void {
    // Stable, so equal-value gifts keep arrival order and nobody is overtaken
    // by someone who sent the same thing after them.
    this.queue.sort((a, b) => valueOf(b) - valueOf(a));
  }
}
