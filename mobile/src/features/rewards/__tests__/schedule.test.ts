import { ladderDays, peakWindow } from '@/features/rewards/schedule';
import { istDate } from '@/lib/preferences';

const LADDER = [20, 30, 40, 60, 80, 100, 150];

/** A moment at the given IST wall-clock time. */
function ist(hhmm: string): number {
  return Date.parse(`2026-09-16T${hhmm}:00+05:30`);
}

describe('the check-in ladder', () => {
  it('offers today, with the streak so far ticked', () => {
    const days = ladderDays({ ladder: LADDER, claimedToday: false, streakDay: 3 });
    expect(days.map((d) => d.state)).toEqual([
      'claimed',
      'claimed',
      'today',
      'upcoming',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    expect(days[2].coins).toBe(40);
  });

  it('ticks today once claimed', () => {
    const days = ladderDays({ ladder: LADDER, claimedToday: true, streakDay: 3 });
    expect(days.slice(0, 4).map((d) => d.state)).toEqual([
      'claimed',
      'claimed',
      'claimed',
      'upcoming',
    ]);
  });

  it('starts a fresh row after a wrap or a missed day', () => {
    const days = ladderDays({ ladder: LADDER, claimedToday: false, streakDay: 1 });
    expect(days[0].state).toBe('today');
    expect(days.slice(1).every((d) => d.state === 'upcoming')).toBe(true);
  });
});

describe('peak hours', () => {
  const evening = { peakStartIst: '20:00', peakEndIst: '23:00' };

  it('is live inside the window', () => {
    expect(peakWindow(evening, ist('20:00'))).toEqual({ live: true });
    expect(peakWindow(evening, ist('22:59'))).toEqual({ live: true });
  });

  it('says how long until it starts', () => {
    expect(peakWindow(evening, ist('18:30'))).toEqual({ live: false, startsInMinutes: 90 });
    // After it ends, the next start is tomorrow.
    expect(peakWindow(evening, ist('23:00'))).toEqual({ live: false, startsInMinutes: 21 * 60 });
  });

  it('handles a window that crosses midnight', () => {
    const late = { peakStartIst: '22:00', peakEndIst: '02:00' };
    expect(peakWindow(late, ist('23:30'))).toEqual({ live: true });
    expect(peakWindow(late, ist('01:15'))).toEqual({ live: true });
    expect(peakWindow(late, ist('03:00'))).toEqual({ live: false, startsInMinutes: 19 * 60 });
  });
});

describe('the IST day', () => {
  it('turns over at midnight in India, not UTC', () => {
    // 23:30 IST on the 16th is 18:00 UTC on the 16th; 00:30 IST on the 17th is
    // still the 16th in UTC.
    expect(istDate(Date.parse('2026-09-16T23:30:00+05:30'))).toBe('2026-09-16');
    expect(istDate(Date.parse('2026-09-17T00:30:00+05:30'))).toBe('2026-09-17');
  });
});
