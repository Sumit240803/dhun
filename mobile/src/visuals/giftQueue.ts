// The gift animation queue.
//
// Pure and framework-free so it can be tested without a renderer — the logic
// here is the difference between a gift storm looking impressive and looking
// broken.
//
// The problem it solves: Tier 3+ gifts play full-screen for 3–6 seconds. During
// a whale moment, hundreds arrive in that window. You cannot play them all, so
// the queue has to SHED LOAD — and it must shed the cheap ones.
//
// Dropping a ₹15,000 Galaxy because two hundred ₹0.82 Roses were queued ahead of
// it is a refund request and a lost whale. Tier order is therefore the only
// thing that matters when the queue is full.

import { duration } from '@/theme';

export type GiftEffect = 'basic' | 'fullscreen' | 'room_banner' | 'global_announcement';

export interface QueuedGift {
  /** Unique per send — the ledger transaction id, so a replay never double-plays. */
  id: string;
  giftId: string;
  giftName: string;
  tier: number;
  effect: GiftEffect;
  animationAsset: string | null;
  senderName: string;
  hostName: string;
  /** Combo multiplier: x1, x10, x99, x520, x999. */
  quantity: number;
}

/**
 * Only queue what takes over the screen.
 *
 * Tier 1–2 render inline in the message stream — many at once, no queue, no
 * blocking. That is what keeps a room feeling alive during a flood of Roses.
 */
export function needsQueue(effect: GiftEffect): boolean {
  return effect !== 'basic';
}

export function displayDurationMs(effect: GiftEffect): number {
  switch (effect) {
    case 'global_announcement':
      return duration.giftGlobal;
    case 'room_banner':
      return duration.giftBanner;
    case 'fullscreen':
      return duration.giftFullscreen;
    default:
      return 0;
  }
}

/**
 * How many queued gifts to hold.
 *
 * Deliberately small. At 3 seconds each, a queue of eight is already 24 seconds
 * behind live — and an animation for a gift sent half a minute ago is confusing
 * rather than celebratory. Better to drop it and stay current.
 */
const MAX_QUEUE = 8;

export class GiftQueue {
  private queue: QueuedGift[] = [];
  private playing: QueuedGift | null = null;
  private seen = new Set<string>();
  private listeners = new Set<() => void>();

  /**
   * Subscribable so React can read it with useSyncExternalStore.
   *
   * The alternative — mirroring `playing` into component state and calling
   * setState from an effect — causes a cascading re-render on every gift, which
   * is measurable during a storm and is what the lint rule warns about.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stable reference while nothing changes, which useSyncExternalStore requires. */
  getCurrent = (): QueuedGift | null => this.playing;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Adds a gift, dropping the lowest tier if the queue is full.
   *
   * Returns false when the gift was rejected, so a caller can decide whether to
   * show it inline instead of not at all.
   */
  enqueue(gift: QueuedGift): boolean {
    // The same transaction arriving twice — a websocket replay, or the fast path
    // and the outbox both delivering — must never play twice.
    if (this.seen.has(gift.id)) return false;
    this.seen.add(gift.id);
    if (this.seen.size > 500) this.seen = new Set([...this.seen].slice(-250));

    if (!needsQueue(gift.effect)) return false;

    if (this.queue.length < MAX_QUEUE) {
      this.insertByTier(gift);
      return true;
    }

    // Full. Find the cheapest queued gift; if the newcomer outranks it, evict.
    let lowestIndex = 0;
    for (let i = 1; i < this.queue.length; i++) {
      if (this.queue[i].tier < this.queue[lowestIndex].tier) lowestIndex = i;
    }

    if (gift.tier > this.queue[lowestIndex].tier) {
      this.queue.splice(lowestIndex, 1);
      this.insertByTier(gift);
      return true;
    }

    // The newcomer is the cheapest thing in a full queue. Drop it.
    return false;
  }

  /**
   * Inserts by tier, highest first, stable within a tier.
   *
   * A Tier 5 jumps ahead of queued Tier 3s but never INTERRUPTS what is already
   * playing — cutting an animation off mid-way reads as a bug, not as priority.
   */
  private insertByTier(gift: QueuedGift): void {
    const index = this.queue.findIndex((queued) => queued.tier < gift.tier);
    if (index === -1) this.queue.push(gift);
    else this.queue.splice(index, 0, gift);
  }

  /** Takes the next gift to play. Returns null while one is already on screen. */
  next(): QueuedGift | null {
    if (this.playing) return null;
    this.playing = this.queue.shift() ?? null;
    this.emit();
    return this.playing;
  }

  /** Called when an animation finishes, times out, or fails to load. */
  finish(): void {
    this.playing = null;
    this.emit();
  }

  get current(): QueuedGift | null {
    return this.playing;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Leaving a room abandons its queue; a gift from the last room must not follow you. */
  clear(): void {
    this.queue = [];
    this.playing = null;
    this.emit();
  }
}
