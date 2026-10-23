import { verificationSteps } from '@/features/verification/steps';

describe('the verification steps', () => {
  it('starts with both to do, and a photo may be sent', () => {
    expect(verificationSteps({ phoneVerified: false, status: 'none' })).toEqual({
      phone: 'todo',
      face: 'todo',
      canSubmit: true,
      complete: false,
    });
  });

  it('holds the photo step while a reviewer has it, with nothing to send', () => {
    const steps = verificationSteps({ phoneVerified: true, status: 'pending' });
    expect(steps.face).toBe('pending');
    expect(steps.canSubmit).toBe(false);
    expect(steps.complete).toBe(false);
  });

  it('asks for another photo after a rejection', () => {
    const steps = verificationSteps({ phoneVerified: true, status: 'rejected' });
    expect(steps.face).toBe('retry');
    expect(steps.canSubmit).toBe(true);
  });

  it('is complete only when the phone AND the photo are done', () => {
    expect(verificationSteps({ phoneVerified: true, status: 'approved' }).complete).toBe(true);
    expect(verificationSteps({ phoneVerified: false, status: 'approved' }).complete).toBe(false);
    expect(verificationSteps({ phoneVerified: true, status: 'approved' }).canSubmit).toBe(false);
  });
});
