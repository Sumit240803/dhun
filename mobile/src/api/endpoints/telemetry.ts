// The app's own reports, kept by our API beside the server's errors.

import { api } from '@/api/client';
import type { AnalyticsWireBatch } from '@/lib/analyticsTransport';
import type { ClientEvent } from '@/lib/clientEvents';

export interface ClientEventBatch {
  app: {
    version: string;
    build?: string;
    platform: 'android' | 'ios' | 'web';
    env?: 'development' | 'staging' | 'production';
    /** The running OTA bundle: an update id, 'embedded' or 'development'. */
    update?: string;
    channel?: string;
  };
  events: ClientEvent[];
}

/** Product analytics (M21 slice 5). The user is read from the token, never sent. */
export interface AnalyticsBatchBody extends AnalyticsWireBatch {
  app: { version: string; platform: 'android' | 'ios' | 'web'; update?: string };
}

export const telemetryApi = {
  analytics: (batch: AnalyticsBatchBody) =>
    api.post<{ accepted: number }>('client/analytics', batch, { retries: 0 }),
  /**
   * No retries: a failed report is dropped by the queue, never retried into
   * an outage. Anonymous is allowed by the server; the client attaches the
   * token when it has one.
   */
  events: (batch: ClientEventBatch) =>
    api.post<{ accepted: number }>('client/events', batch, { retries: 0 }),
};
