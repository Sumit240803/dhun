// Writing an event to the outbox from outside the ledger.
//
// Money events are written by `postTransaction`, inside the ledger's own
// transaction. Some events that matter are not money — a room starting, which
// is what tells followers a host is live — and they need the same guarantee:
// written in the SAME transaction as the change they describe, so a crash can
// never leave a room that started without anyone ever being told.

import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';

export interface DomainEvent {
  eventType: string;
  /** Ordering holds per key — a room, a user — never globally. */
  partitionKey: string;
  payload: Record<string, unknown>;
}

export async function enqueueEvent(client: PoolClient, event: DomainEvent): Promise<void> {
  await client.query(
    'INSERT INTO outbox (event_id, event_type, partition_key, payload) VALUES ($1, $2, $3, $4::jsonb)',
    [uuidv7(), event.eventType, event.partitionKey, JSON.stringify(event.payload)],
  );
}
