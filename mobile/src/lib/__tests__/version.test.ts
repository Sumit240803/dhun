import { isOlderThan } from '@/lib/version';

describe('version comparison', () => {
  it('compares numerically, not alphabetically', () => {
    // The classic bug: '1.10.0' < '1.9.0' is TRUE as a string, so the tenth
    // release of a line would be force-updated forever.
    expect(isOlderThan('1.10.0', '1.9.0')).toBe(false);
    expect(isOlderThan('1.9.0', '1.10.0')).toBe(true);
  });

  it('treats equal versions as not older', () => {
    expect(isOlderThan('1.2.3', '1.2.3')).toBe(false);
  });

  it('pads a shorter version with zeroes', () => {
    expect(isOlderThan('1.2', '1.2.1')).toBe(true);
    expect(isOlderThan('1.2.1', '1.2')).toBe(false);
  });

  it('does not lock everyone out on a garbage version string', () => {
    // A missing or malformed nativeApplicationVersion parses to 0 and only
    // trips a floor genuinely above it — it must never block by accident.
    expect(isOlderThan('0.0.0', '0.0.0')).toBe(false);
    expect(isOlderThan('not-a-version', '0.0.0')).toBe(false);
  });
});
