import { MIN_AWAY_MS, shouldApply, shouldCheck } from '@/lib/otaPolicy';

describe('OTA policy', () => {
  it('checks after a long absence, never sooner', () => {
    expect(shouldCheck({ awayMs: MIN_AWAY_MS, inRoom: false })).toBe(true);
    expect(shouldCheck({ awayMs: MIN_AWAY_MS - 1, inRoom: false })).toBe(false);
  });

  it('never touches a room, open or minimised, however long away', () => {
    expect(shouldCheck({ awayMs: 10 * MIN_AWAY_MS, inRoom: true })).toBe(false);
    expect(shouldApply({ awayMs: 10 * MIN_AWAY_MS, inRoom: true, fetched: true })).toBe(false);
  });

  it('applies only something that was actually fetched', () => {
    expect(shouldApply({ awayMs: MIN_AWAY_MS, inRoom: false, fetched: false })).toBe(false);
    expect(shouldApply({ awayMs: MIN_AWAY_MS, inRoom: false, fetched: true })).toBe(true);
  });
});
