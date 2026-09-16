// Entrances waiting to be shown, one at a time.
//
// The server announces only people wearing an entry effect, and only once per
// room per few minutes — but a popular host going live can still draw a burst
// of them at once. They play one after another, and when the backlog grows the
// OLDEST waiting entrance is dropped: an arrival announced a minute late is
// about someone already sitting in the room, which is confusing rather than
// grand.
//
// Pure and framework-free, like the gift queue and the strip lanes.

import type { EntryView } from '@/api/types';

const MAX_WAITING = 4;

export class EntryEffects {
  private waiting: EntryView[] = [];
  private showing: EntryView | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getCurrent = (): EntryView | null => this.showing;

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  push(entry: EntryView): void {
    // The same person twice in a backlog is one entrance, not two.
    if (this.showing?.userId === entry.userId) return;
    if (this.waiting.some((waiting) => waiting.userId === entry.userId)) return;

    this.waiting.push(entry);
    if (this.waiting.length > MAX_WAITING) this.waiting.shift();

    if (!this.showing) this.advance();
  }

  /** The one on screen has finished. */
  finish(): void {
    this.showing = null;
    this.advance();
  }

  private advance(): void {
    this.showing = this.waiting.shift() ?? null;
    this.emit();
  }

  get pending(): number {
    return this.waiting.length;
  }

  clear(): void {
    this.waiting = [];
    this.showing = null;
    this.emit();
  }
}
