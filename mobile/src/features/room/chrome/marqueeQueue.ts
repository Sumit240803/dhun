// The announcement strip's queue.
//
// An external store rather than component state, following `giftStrips.ts` and
// `giftQueue.ts` — the two things in this app that already had exactly this
// shape. The reason is the same one stated there: announcements arrive over the
// room's socket at whatever rate a combo produces, and mirroring an incoming
// event into React state means a setState from an effect on every single gift,
// plus a re-render of the room each time.
//
// Pure and framework-free, so a gift storm can be tested without a renderer.
//
// ── The rules ───────────────────────────────────────────────────────────────
//
//   1. ONE AT A TIME, OLDEST FIRST. Announcements are a narrative; showing the
//      newest first tells it backwards.
//
//   2. A BURST IS PLAYED OUT, NOT DROPPED. The burst IS the event worth seeing.
//
//   3. THE QUEUE IS CAPPED, AND DROPS THE CHEAPEST. A two-hour room must not
//      accumulate an hour of backlog, and if something has to go it should not
//      be the Galaxy sitting behind thirty Scooters — the same reasoning that
//      makes the gift queue shed its cheapest item rather than its newest.

export interface MarqueeItem {
  id: string;
  /** `gift` happened here; `global` crossed every room; `system` is ours. */
  kind: 'gift' | 'global' | 'system';
  text: string;
  /**
   * What the announcement was worth, for rule 3. Absent for system lines,
   * which are never shed — they are policy, not spectacle.
   */
  weight?: number;
}

/** How many can wait. Past this, the least valuable is dropped. */
const MAX_QUEUED = 12;

export class MarqueeQueue {
  private queue: MarqueeItem[] = [];
  private current: MarqueeItem | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  /** Ids already seen, so a redelivered socket event cannot show twice. */
  private seen = new Set<string>();

  constructor(private readonly holdMs: number = 5_000) {}

  push(item: MarqueeItem): void {
    if (this.seen.has(item.id)) return;
    this.seen.add(item.id);
    // Bounded: a long broadcast would otherwise keep every id it ever saw.
    if (this.seen.size > 500) {
      this.seen = new Set([...this.seen].slice(-200));
    }

    this.queue.push(item);
    if (this.queue.length > MAX_QUEUED) this.shedCheapest();
    if (this.current === null) this.advance();
    else this.emit();
  }

  /** The announcement on screen, or null. */
  getSnapshot = (): MarqueeItem | null => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stops the timer. Must run when the room closes, or it fires into nothing. */
  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
    this.current = null;
    this.emit();
  }

  private advance(): void {
    if (this.timer) clearTimeout(this.timer);
    this.current = this.queue.shift() ?? null;
    this.emit();

    if (this.current === null) {
      this.timer = null;
      return;
    }
    this.timer = setTimeout(() => this.advance(), this.holdMs);
  }

  private shedCheapest(): void {
    let index = -1;
    let lowest = Infinity;
    this.queue.forEach((item, at) => {
      // System lines are never shed — see the type's comment.
      if (item.kind === 'system') return;
      const weight = item.weight ?? 0;
      if (weight < lowest) {
        lowest = weight;
        index = at;
      }
    });
    if (index >= 0) this.queue.splice(index, 1);
    else this.queue.shift();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
