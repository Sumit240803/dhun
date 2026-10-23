import { splitRemaining } from '@/features/rewards/newUser/countdown';

describe('the new-user countdown', () => {
  it('reads a fresh account as seven whole days', () => {
    expect(splitRemaining(7 * 86_400_000)).toMatchObject({ d: 7, h: 0, m: 0, s: 0 });
  });

  it('splits into days, hours, minutes and seconds', () => {
    const ms = ((6 * 24 + 23) * 3600 + 59 * 60 + 12) * 1000 + 999;
    expect(splitRemaining(ms)).toMatchObject({ d: 6, h: 23, m: 59, s: 12 });
  });

  it('stops at zero rather than counting into the past', () => {
    expect(splitRemaining(-5_000)).toEqual({ d: 0, h: 0, m: 0, s: 0, ms: 0 });
  });
});
