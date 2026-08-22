// Drains the outbox.
//
// Events are written inside the same transaction as the ledger entries, so they
// are already durable and can never disagree with the money. This job is the
// other half: nothing consumes them until it runs, and an outbox that is written
// but never shipped looks exactly like a working pipeline while delivering
// nothing.
//
// Ordering is guaranteed PER PARTITION KEY (a room, a user), never globally.
// That is all any consumer needs, and global ordering would serialise the whole
// system through one cursor.

import { pool, withTransaction } from '../../infra/db.js';
import { logger } from '../../infra/logger.js';
import { alert } from '../../infra/alerts.js';
import { getEventPublisher, OutboxEventRecord } from '../publisher.js';
import type { Job } from '../scheduler.js';

const BATCH_SIZE = 200;
/** Give up after this many tries and alert, rather than retrying forever. */
const MAX_ATTEMPTS = 10;

interface OutboxRow {
  id: string;
  event_id: string;
  event_type: string;
  partition_key: string;
  payload: Record<string, unknown>;
  txn_id: string | null;
  created_at: Date;
  attempts: number;
}

export async function shipOutboxBatch(): Promise<{ published: number; failed: number }> {
  return withTransaction(async (client) => {
    // SKIP LOCKED lets several shippers run without ever handing the same row to
    // two of them. Ordering by id keeps each partition in the order it was
    // written, because ids are monotonic.
    const { rows } = await client.query<OutboxRow>(
      'SELECT id, event_id, event_type, partition_key, payload, txn_id, created_at, attempts' +
        ' FROM outbox' +
        ' WHERE published_at IS NULL AND attempts < $2' +
        ' ORDER BY id' +
        ' LIMIT $1' +
        ' FOR UPDATE SKIP LOCKED',
      [BATCH_SIZE, MAX_ATTEMPTS],
    );

    if (!rows.length) return { published: 0, failed: 0 };

    const events: OutboxEventRecord[] = rows.map((r) => ({
      id: Number(r.id),
      eventId: r.event_id,
      eventType: r.event_type,
      partitionKey: r.partition_key,
      payload: r.payload,
      txnId: r.txn_id,
      createdAt: r.created_at,
    }));

    try {
      await getEventPublisher().publish(events);
    } catch (err) {
      // The rows stay locked until this transaction ends, then become available
      // again. Counting the attempt is what eventually stops a poison message
      // from being retried forever.
      await client.query(
        'UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = ANY($1::bigint[])',
        [rows.map((r) => r.id), String(err instanceof Error ? err.message : err).slice(0, 1000)],
      );
      logger.error('outbox publish failed', err, { batch: rows.length });
      return { published: 0, failed: rows.length };
    }

    await client.query(
      'UPDATE outbox SET published_at = now() WHERE id = ANY($1::bigint[])',
      [rows.map((r) => r.id)],
    );

    return { published: rows.length, failed: 0 };
  });
}

/**
 * Events that have exhausted their retries.
 *
 * These are dropped from the normal batch, so without this check they would sit
 * unpublished and unnoticed — which is the failure mode the outbox exists to
 * prevent.
 */
async function alertOnPoisonedEvents(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT count(*) FROM outbox WHERE published_at IS NULL AND attempts >= $1',
    [MAX_ATTEMPTS],
  );
  const stuck = Number(rows[0].count);

  if (stuck > 0) {
    await alert({
      severity: 'page',
      key: 'outbox:poisoned',
      title: `${stuck} outbox events have exhausted their retries`,
      detail: { stuck, maxAttempts: MAX_ATTEMPTS },
    });
  }
  return stuck;
}

export const outboxShipperJob: Job = {
  name: 'outbox_shipper',
  // A floor, not the primary trigger: the process also LISTENs for a wakeup, so
  // in practice a batch ships within milliseconds. This catches anything a
  // missed notification would otherwise strand.
  everyMs: 2_000,
  pageOnFailure: true,
  run: async () => {
    let published = 0;
    let batches = 0;

    // Keep draining while full batches come back, so a backlog clears in one
    // pass instead of 200 events per tick.
    for (;;) {
      const result = await shipOutboxBatch();
      published += result.published;
      batches += 1;
      if (result.published < BATCH_SIZE || result.failed > 0) break;
    }

    const stuck = await alertOnPoisonedEvents();
    return published || stuck ? { published, batches, stuck } : undefined;
  },
};
