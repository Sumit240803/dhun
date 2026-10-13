// What the workers do with events, beyond shipping them.
//
// The outbox is the DURABLE path (ledger-decisions § B8): anything that must
// eventually happen because something else happened — a referrer paid because
// their friend recharged, followers told a host is live — is driven from here,
// never from inside the API request that caused it. A crash between the two
// then delays the consequence instead of losing it.
//
// Delivery is at least once. Every consumer is idempotent on its own terms
// (a referral is keyed on the referred user; a live notification is keyed on
// follower + room), so a retried batch repeats nothing that matters.

import { logger } from '../infra/logger.js';
import { pkOnGiftToHost } from '../modules/games/index.js';
import { notifyFollowersLive } from '../modules/notifications/index.js';
import { rewardReferral } from '../modules/rewards/index.js';
import type { EventPublisher, OutboxEventRecord } from './publisher.js';

type Consumer = (payload: Record<string, unknown>) => Promise<unknown>;

const CONSUMERS: Record<string, Consumer[]> = {
  purchase_completed: [
    (payload) =>
      rewardReferral({
        userId: String(payload.user_id),
        amountPaise: Number(payload.amount_paise),
      }),
  ],
  /**
   * A gift landed. If its recipient is in a battle, re-push both scores.
   *
   * Through the outbox rather than from the gift request, because rule 3 of the
   * monolith is that side effects go through the event bus — and concretely,
   * because a scoreboard must never be able to make a gift fail or wait. The
   * ledger has already paid the host by the time this runs.
   *
   * Idempotent for free: it recomputes a SUM and pushes it. A replayed event
   * re-pushes the same number.
   */
  gift_sent: [(payload) => pkOnGiftToHost(String(payload.recipient_id))],
  room_started: [
    (payload) =>
      notifyFollowersLive({
        roomId: String(payload.room_id),
        hostId: String(payload.host_id),
        title: String(payload.title ?? ''),
      }),
  ],
};

/**
 * Runs every consumer for a batch, in order.
 *
 * Throws on the first failure, so the shipper leaves the batch unpublished and
 * counts the attempt — the same poison-message handling every other publish
 * failure gets.
 */
export async function consumeEvents(events: OutboxEventRecord[]): Promise<void> {
  for (const event of events) {
    for (const consumer of CONSUMERS[event.eventType] ?? []) {
      try {
        await consumer(event.payload);
      } catch (err) {
        logger.error('outbox consumer failed', err, {
          event: event.eventType,
          event_id: event.eventId,
        });
        throw err;
      }
    }
  }
}

/** A publisher that ships, then consumes — what the workers process runs. */
export function withConsumers(base: EventPublisher): EventPublisher {
  return {
    name: `${base.name}+consumers`,
    async publish(events) {
      await base.publish(events);
      await consumeEvents(events);
    },
  };
}
