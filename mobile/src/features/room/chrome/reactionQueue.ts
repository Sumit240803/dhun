// The reactions floating over the stage right now.
//
// An external store, like the marquee: the socket pushes into it from outside
// React and the layer subscribes. Each reaction lives about a second and a
// half — long enough to read, short enough that a busy room is a stream, not
// a wall. Capped, so a storm of taps sheds the oldest rather than growing.

import type { Reaction } from '@/api/types';

export interface FloatingReaction {
  id: string;
  emoji: Reaction;
  /** Horizontal start, 0–1 across the lane, so simultaneous ones do not stack. */
  lane: number;
  /** Sideways drift in points over the rise, decided here so the render stays pure. */
  drift: number;
}

const MAX_VISIBLE = 18;
const LIFETIME_MS = 1_600;

export class ReactionQueue {
  private items: FloatingReaction[] = [];
  private listeners = new Set<() => void>();
  private counter = 0;

  push(emoji: Reaction): void {
    const item: FloatingReaction = {
      id: `r-${++this.counter}`,
      emoji,
      lane: Math.random(),
      drift: (Math.random() - 0.5) * 28,
    };
    this.items = [...this.items, item].slice(-MAX_VISIBLE);
    this.emit();
    setTimeout(() => this.remove(item.id), LIFETIME_MS);
  }

  getSnapshot = (): FloatingReaction[] => this.items;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  clear(): void {
    this.items = [];
    this.emit();
  }

  private remove(id: string): void {
    if (!this.items.some((item) => item.id === id)) return;
    this.items = this.items.filter((item) => item.id !== id);
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
