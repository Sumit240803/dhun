// What a poll looks like on screen, from what the server said.

import type { PollView } from '@/api/types';

/** Each option's share of the vote, 0..1. All zero when nobody has voted. */
export function pollShares(poll: PollView): number[] {
  if (poll.total === 0) return poll.options.map(() => 0);
  return poll.options.map((option) => option.votes / poll.total);
}

/** Whole seconds until the clock closes it; 0 once it has. */
export function pollSecondsLeft(poll: PollView, now: number = Date.now()): number {
  if (poll.closedAt !== null) return 0;
  return Math.max(0, Math.ceil((new Date(poll.endsAt).getTime() - now) / 1000));
}

/** Closed by the host or by the clock. */
export function pollOver(poll: PollView, now: number = Date.now()): boolean {
  return poll.closedAt !== null || pollSecondsLeft(poll, now) === 0;
}

/** The winning option's index once it is over, or null for a tie or no votes. */
export function pollLeader(poll: PollView): number | null {
  if (poll.total === 0) return null;
  let best = -1;
  let bestVotes = -1;
  let tied = false;
  poll.options.forEach((option, index) => {
    if (option.votes > bestVotes) {
      best = index;
      bestVotes = option.votes;
      tied = false;
    } else if (option.votes === bestVotes) {
      tied = true;
    }
  });
  return tied ? null : best;
}

/** "1:05" from seconds. */
export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
