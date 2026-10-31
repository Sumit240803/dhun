// The app's own reports, kept by our API beside the server's errors.

import { api } from '@/api/client';
import type { ClientEvent } from '@/lib/clientEvents';

export interface ClientEventBatch {
  app: {
    version: string;
    build?: string;
    platform: 'android' | 'ios' | 'web';
    env?: 'development' | 'staging' | 'production';
  };
  events: ClientEvent[];
}

export const telemetryApi = {
  /**
   * No retries: a failed report is dropped by the queue, never retried into
   * an outage. Anonymous is allowed by the server; the client attaches the
   * token when it has one.
   */
  events: (batch: ClientEventBatch) =>
    api.post<{ accepted: number }>('client/events', batch, { retries: 0 }),
};
