import type { PollView } from '@/api/types';
import { clock, pollLeader, pollOver, pollSecondsLeft, pollShares } from '@/features/room/polls';

const base: PollView = {
  id: 'p',
  question: 'Next song?',
  options: [
    { text: 'A', votes: 3 },
    { text: 'B', votes: 1 },
  ],
  total: 4,
  endsAt: '2030-01-01T00:02:00Z',
  closedAt: null,
  myVote: null,
};

describe('poll helpers', () => {
  it('shares sum to one, and are all zero with no votes', () => {
    expect(pollShares(base)).toEqual([0.75, 0.25]);
    expect(
      pollShares({ ...base, total: 0, options: base.options.map((o) => ({ ...o, votes: 0 })) }),
    ).toEqual([0, 0]);
  });
  it('counts down to the clock and stops at zero', () => {
    const now = new Date('2030-01-01T00:01:05Z').getTime();
    expect(pollSecondsLeft(base, now)).toBe(55);
    expect(pollSecondsLeft(base, now + 120_000)).toBe(0);
    expect(pollSecondsLeft({ ...base, closedAt: '2030-01-01T00:00:30Z' }, now)).toBe(0);
  });
  it('is over when closed or when the clock ran out', () => {
    const now = new Date('2030-01-01T00:01:05Z').getTime();
    expect(pollOver(base, now)).toBe(false);
    expect(pollOver(base, now + 60_000)).toBe(true);
    expect(pollOver({ ...base, closedAt: '2030-01-01T00:00:30Z' }, now)).toBe(true);
  });
  it('names a leader only when there is one', () => {
    expect(pollLeader(base)).toBe(0);
    expect(
      pollLeader({
        ...base,
        options: [
          { text: 'A', votes: 2 },
          { text: 'B', votes: 2 },
        ],
      }),
    ).toBeNull();
    expect(pollLeader({ ...base, total: 0 })).toBeNull();
  });
  it('formats a clock', () => {
    expect(clock(65)).toBe('1:05');
    expect(clock(0)).toBe('0:00');
  });
});
