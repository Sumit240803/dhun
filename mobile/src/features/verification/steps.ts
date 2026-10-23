// The verification screen's two steps, as states.
//
// Pure, so the screen's logic — what is done, what is waiting, whether the
// submit button exists — can be tested without rendering a camera.

import type { HostVerification } from '@/api/types';

/** 'retry' is a rejection: done once, not accepted, do it again. */
export type StepState = 'todo' | 'pending' | 'done' | 'retry';

export interface VerificationSteps {
  phone: Extract<StepState, 'todo' | 'done'>;
  face: StepState;
  /** A photo may be taken and sent. False while one is being reviewed, and once approved. */
  canSubmit: boolean;
  /** Everything approved. */
  complete: boolean;
}

export function verificationSteps(input: {
  phoneVerified: boolean;
  status: HostVerification['status'];
}): VerificationSteps {
  const face: StepState =
    input.status === 'approved'
      ? 'done'
      : input.status === 'pending'
        ? 'pending'
        : input.status === 'rejected'
          ? 'retry'
          : 'todo';

  return {
    phone: input.phoneVerified ? 'done' : 'todo',
    face,
    canSubmit: face === 'todo' || face === 'retry',
    complete: input.phoneVerified && face === 'done',
  };
}
