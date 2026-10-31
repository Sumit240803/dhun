import { capIssues, draftFrom, parseCap, raisesCap } from '@/features/account/spending';
import type { SpendStatus } from '@/api/types';

const base: SpendStatus = {
  dailyCapCoins: null,
  monthlyCapCoins: null,
  pending: null,
  excludedUntil: null,
  excludedPermanently: false,
  excluded: false,
  todayCoins: 0,
  monthCoins: 0,
  coolingOff: false,
  coolingOffAtCoins: 5_500_000,
};

describe('parseCap', () => {
  it('reads an empty field as no limit', () => {
    expect(parseCap('')).toBeNull();
    expect(parseCap('  ')).toBeNull();
  });
  it('accepts Indian grouping', () => {
    expect(parseCap('1,00,000')).toBe(100000);
  });
  it('rejects anything that is not digits', () => {
    expect(Number.isNaN(parseCap('10k'))).toBe(true);
    expect(Number.isNaN(parseCap('-5'))).toBe(true);
  });
});

describe('capIssues', () => {
  it('passes a clean draft', () => {
    expect(capIssues({ daily: '5000', monthly: '50000', exclusion: 'none' })).toEqual({});
    expect(capIssues({ daily: '', monthly: '', exclusion: 'none' })).toEqual({});
  });
  it('refuses a cap below the floor', () => {
    expect(capIssues({ daily: '50', monthly: '', exclusion: 'none' })).toEqual({
      daily: 'tooSmall',
    });
  });
  it('refuses a daily cap above the monthly one', () => {
    expect(capIssues({ daily: '60000', monthly: '50000', exclusion: 'none' })).toEqual({
      daily: 'dailyAboveMonthly',
    });
  });
});

describe('raisesCap', () => {
  it('treats removing a cap as a raise', () => {
    expect(raisesCap(5000, null)).toBe(true);
  });
  it('treats setting a first cap as a lowering', () => {
    expect(raisesCap(null, 5000)).toBe(false);
  });
  it('compares numbers otherwise', () => {
    expect(raisesCap(5000, 6000)).toBe(true);
    expect(raisesCap(5000, 4000)).toBe(false);
  });
});

describe('draftFrom', () => {
  it('shows caps as digits and no cap as empty', () => {
    expect(draftFrom({ ...base, dailyCapCoins: 5000 })).toEqual({
      daily: '5000',
      monthly: '',
      exclusion: 'none',
    });
  });
  it('shows a permanent pause', () => {
    expect(draftFrom({ ...base, excludedPermanently: true }).exclusion).toBe('permanent');
  });
  it('leaves a running pause alone', () => {
    expect(
      draftFrom({ ...base, excluded: true, excludedUntil: '2030-01-01T00:00:00Z' }).exclusion,
    ).toBeNull();
  });
});
