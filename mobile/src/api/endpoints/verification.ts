// Host identity verification — the face half. Phone OTP lives in auth.

import { api } from '@/api/client';
import type { HostVerification } from '@/api/types';

export const verificationApi = {
  /** Where this account's verification stands. `status: 'none'` until a photo is sent. */
  me: () => api.get<{ verification: HostVerification }>('verification/me'),
  /**
   * Sends an upload KEY, never a URL — the same contract as avatars. The
   * server proves the object sits under this user's own prefix before anything
   * is written. Reviewed by a person in the admin panel.
   */
  submit: (faceKey: string) =>
    api.post<{ verification: HostVerification }>('verification', { faceKey }),
};
