// Where push notifications go.
//
// Behind an interface for the same reason OTP and IAP are: development and
// tests must not reach a real phone, and the vendor must be replaceable. Expo's
// service is chosen because it fronts both FCM and APNs behind one token the
// app already knows how to get, and it costs nothing.

import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Delivered to the app when the notification is tapped. */
  data: Record<string, string>;
}

export type PushOutcome =
  | { ok: true }
  /** The token is dead — uninstalled, or permission revoked. Stop sending to it. */
  | { ok: false; unregistered: true }
  | { ok: false; unregistered: false; error: string };

export interface PushProvider {
  readonly name: string;
  /** One outcome per message, in order. Must not throw for a per-message failure. */
  send(messages: PushMessage[]): Promise<PushOutcome[]>;
}

/** Development and tests: logs, and keeps what it sent so a test can look. */
export class ConsolePushProvider implements PushProvider {
  readonly name = 'console';
  readonly sent: PushMessage[] = [];

  async send(messages: PushMessage[]): Promise<PushOutcome[]> {
    for (const message of messages) {
      this.sent.push(message);
      logger.info('push (console)', { title: message.title, data: message.data });
    }
    return messages.map(() => ({ ok: true }) as const);
  }
}

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const EXPO_BATCH = 100;

export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';

  async send(messages: PushMessage[]): Promise<PushOutcome[]> {
    const outcomes: PushOutcome[] = [];

    for (let start = 0; start < messages.length; start += EXPO_BATCH) {
      const batch = messages.slice(start, start + EXPO_BATCH);
      outcomes.push(...(await this.sendBatch(batch)));
    }
    return outcomes;
  }

  private async sendBatch(batch: PushMessage[]): Promise<PushOutcome[]> {
    try {
      const response = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(config.push.expoAccessToken
            ? { Authorization: `Bearer ${config.push.expoAccessToken}` }
            : {}),
        },
        body: JSON.stringify(
          batch.map((message) => ({
            to: message.token,
            title: message.title,
            body: message.body,
            data: message.data,
            sound: 'default',
            // Android groups by channel; the app creates this one.
            channelId: 'live',
          })),
        ),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        logger.error('expo push request failed', { status: response.status });
        return batch.map(() => ({ ok: false, unregistered: false, error: `HTTP ${response.status}` }));
      }

      const body = (await response.json()) as {
        data?: Array<{ status: string; message?: string; details?: { error?: string } }>;
      };

      return batch.map((_, index) => {
        const ticket = body.data?.[index];
        if (ticket?.status === 'ok') return { ok: true } as const;
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          return { ok: false, unregistered: true } as const;
        }
        return {
          ok: false,
          unregistered: false,
          error: ticket?.details?.error ?? ticket?.message ?? 'unknown',
        } as const;
      });
    } catch (err) {
      // A push outage costs notifications, never the job that asked for them.
      logger.error('expo push unreachable', { err });
      return batch.map(() => ({ ok: false, unregistered: false, error: 'unreachable' }) as const);
    }
  }
}

let provider: PushProvider =
  config.push.provider === 'expo' ? new ExpoPushProvider() : new ConsolePushProvider();

export function getPushProvider(): PushProvider {
  return provider;
}

/** Test seam. */
export function setPushProvider(next: PushProvider): void {
  provider = next;
}
