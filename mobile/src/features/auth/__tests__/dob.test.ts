import { MIN_AGE, ageInYears, earliestDob, latestAdultDob, toApiDate } from '@/features/auth/dob';

describe('toApiDate', () => {
  it('formats from LOCAL calendar parts, not through toISOString', () => {
    // The bug this exists to prevent: a picker returns local midnight, and
    // toISOString() converts to UTC — which in IST is 18:30 the previous day.
    // Every date sent between 00:00 and 05:30 would be a day early.
    const localMidnight = new Date(1998, 3, 12, 0, 0, 0);
    expect(toApiDate(localMidnight)).toBe('1998-04-12');
  });

  it('pads single-digit months and days', () => {
    expect(toApiDate(new Date(2000, 0, 5))).toBe('2000-01-05');
  });

  it('survives a time late in the day, which naive UTC conversion does not', () => {
    const lateEvening = new Date(1998, 3, 12, 23, 45, 0);
    expect(toApiDate(lateEvening)).toBe('1998-04-12');
  });
});

describe('ageInYears', () => {
  const today = new Date(2026, 7, 23); // 23 August 2026

  it('counts a birthday that has passed this year', () => {
    expect(ageInYears(new Date(2000, 0, 1), today)).toBe(26);
  });

  it('does not count a birthday still to come this year', () => {
    expect(ageInYears(new Date(2000, 11, 31), today)).toBe(25);
  });

  it('counts the birthday itself, from the morning', () => {
    expect(ageInYears(new Date(2008, 7, 23), today)).toBe(18);
  });

  it('is one short the day before the birthday', () => {
    expect(ageInYears(new Date(2008, 7, 24), today)).toBe(17);
  });
});

describe('the pickable range', () => {
  const today = new Date(2026, 7, 23);

  it('stops at the latest date that is still 18, so underage cannot be chosen', () => {
    const latest = latestAdultDob(today);
    expect(ageInYears(latest, today)).toBe(MIN_AGE);

    const oneDayLater = new Date(latest.getFullYear(), latest.getMonth(), latest.getDate() + 1);
    expect(ageInYears(oneDayLater, today)).toBe(MIN_AGE - 1);
  });

  it('bounds the other end, so the spinner does not scroll to 1900', () => {
    expect(earliestDob(today).getFullYear()).toBe(1926);
  });
});
