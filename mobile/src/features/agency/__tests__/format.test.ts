import { ApiError } from '@/api/client';
import { cooldownUntil, personName } from '@/features/agency/format';

describe('the quit cooldown date', () => {
  it('reads nextAllowedAt from a QUIT_COOLDOWN refusal', () => {
    const error = new ApiError('QUIT_COOLDOWN', 'later', 409, {
      nextAllowedAt: '2026-11-04T10:00:00.000Z',
    });
    expect(cooldownUntil(error)).toBe('2026-11-04T10:00:00.000Z');
  });

  it('ignores every other error, and a malformed detail', () => {
    expect(cooldownUntil(new ApiError('NOT_IN_AGENCY', 'no', 409))).toBeUndefined();
    expect(
      cooldownUntil(new ApiError('QUIT_COOLDOWN', 'later', 409, { nextAllowedAt: 5 })),
    ).toBeUndefined();
    expect(cooldownUntil(new Error('boom'))).toBeUndefined();
  });
});

describe('a person in an agency', () => {
  it('falls back to the public id when there is no display name', () => {
    expect(personName({ displayName: 'Sunita', publicId: 10000002 })).toBe('Sunita');
    expect(personName({ displayName: null, publicId: 10000002 })).toBe('10000002');
  });
});
