// A suspended host's side of an appeal. Reviewing happens in the admin panel.

import { api } from '@/api/client';
import type { MyAppeal } from '@/api/types';

export const appealsApi = {
  me: () => api.get<{ appeal: MyAppeal }>('appeals/me'),
  /** One per suspension; the server refuses a second with APPEAL_PENDING or APPEAL_DECIDED. */
  file: (message: string) => api.post<{ appeal: MyAppeal }>('appeals', { message }),
};
