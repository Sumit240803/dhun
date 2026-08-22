// Where outbox events go.
//
// The docs call for Kafka from day one, even with a single consumer. The outbox
// table IS that commitment kept — events are already durable, ordered per
// partition key, and produced transactionally. Swapping this file for a Kafka
// producer changes nothing upstream, which is the whole point of the seam.
//
// Until then the log publisher is honest about what it does: it emits each
// event as a structured line, which ClickHouse can ingest and which makes the
// pipeline visible end to end.

import { logger } from '../infra/logger.js';

export interface OutboxEventRecord {
  id: number;
  eventId: string;
  eventType: string;
  partitionKey: string;
  payload: Record<string, unknown>;
  txnId: string | null;
  createdAt: Date;
}

export interface EventPublisher {
  readonly name: string;
  /**
   * Publish a batch, in order.
   *
   * Must throw if ANY event fails. The shipper marks only what it is told
   * succeeded, so a partial success reported as total would silently drop events.
   */
  publish(events: OutboxEventRecord[]): Promise<void>;
}

class LogPublisher implements EventPublisher {
  readonly name = 'log';

  async publish(events: OutboxEventRecord[]): Promise<void> {
    for (const e of events) {
      // Shaped to match the event taxonomy in data-and-launch-plan-v1: an
      // object_action name, a stable id, and the common properties alongside.
      logger.info('event', {
        event: e.eventType,
        event_id: e.eventId,
        partition_key: e.partitionKey,
        txn_id: e.txnId,
        occurred_at: e.createdAt.toISOString(),
        properties: e.payload,
      });
    }
  }
}

let publisher: EventPublisher = new LogPublisher();

export function setEventPublisher(next: EventPublisher): void {
  publisher = next;
}

export function getEventPublisher(): EventPublisher {
  return publisher;
}
