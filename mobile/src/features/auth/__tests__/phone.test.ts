import {
  formatE164ForDisplay,
  formatNational,
  isValidNational,
  normaliseDigits,
  toE164,
} from '@/features/auth/phone';

describe('normaliseDigits', () => {
  it('strips the grouping space the field displays', () => {
    expect(normaliseDigits('98765 43210')).toBe('9876543210');
  });

  it('strips a pasted country code and formatting', () => {
    expect(normaliseDigits('+91 (98765) 43-210')).toBe('9198765432');
  });

  it('caps at ten digits so a pasted longer string cannot overflow the field', () => {
    expect(normaliseDigits('98765432101234')).toBe('9876543210');
  });
});

describe('isValidNational', () => {
  it.each(['6000000000', '7000000000', '8000000000', '9876543210'])('accepts %s', (number) => {
    expect(isValidNational(number)).toBe(true);
  });

  it('rejects numbers that do not start 6-9', () => {
    // Indian mobile numbers never start below 6. Catching it on device turns a
    // server round trip into an instant message.
    expect(isValidNational('5876543210')).toBe(false);
    expect(isValidNational('0876543210')).toBe(false);
  });

  it('rejects anything that is not exactly ten digits', () => {
    expect(isValidNational('987654321')).toBe(false);
    expect(isValidNational('98765432101')).toBe(false);
  });
});

describe('E.164', () => {
  it('is what the API receives — no spaces, no brackets', () => {
    expect(toE164('9876543210')).toBe('+919876543210');
  });

  it('reads back grouped the way an Indian user reads a number', () => {
    expect(formatE164ForDisplay('+919876543210')).toBe('+91 98765 43210');
  });
});

describe('formatNational', () => {
  it('groups five and five, and only once there is a second group', () => {
    expect(formatNational('98765')).toBe('98765');
    expect(formatNational('987654')).toBe('98765 4');
    expect(formatNational('9876543210')).toBe('98765 43210');
  });
});
