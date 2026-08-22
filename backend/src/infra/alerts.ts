// Alerting.
//
// Separate from logging on purpose. A log line is something you read when you go
// looking; an alert is something that finds you. The reconciliation job is
// required to page on mismatch, and "we logged an error" is not paging.
//
// The transport is deliberately pluggable and unimplemented: wiring PagerDuty or
// Opsgenie is a Track 0 account task, and the code should not wait on it.

import { logger } from './logger.js';

export type AlertSeverity = 'page' | 'warn';

export interface Alert {
  severity: AlertSeverity;
  /** Stable identifier, so repeats can be deduplicated rather than storming. */
  key: string;
  title: string;
  detail?: Record<string, unknown>;
}

export interface AlertTransport {
  send(alert: Alert): Promise<void>;
}

/**
 * Default transport: a log line tagged so an alerting rule can match on it.
 *
 * Not silent, and not pretending to page. Until a real transport is configured,
 * `alert=true` in structured logs is what a CloudWatch or Grafana rule keys off.
 */
class LogTransport implements AlertTransport {
  async send(a: Alert): Promise<void> {
    const payload = { alert: true, severity: a.severity, alert_key: a.key, ...a.detail };
    if (a.severity === 'page') logger.error(`ALERT ${a.title}`, undefined, payload);
    else logger.warn(`ALERT ${a.title}`, payload);
  }
}

let transport: AlertTransport = new LogTransport();

export function setAlertTransport(next: AlertTransport): void {
  transport = next;
}

/**
 * Raise an alert. Never throws.
 *
 * A failure to alert must not take down the job that was trying to report a
 * problem — that turns one incident into two.
 */
export async function alert(a: Alert): Promise<void> {
  try {
    await transport.send(a);
  } catch (err) {
    logger.error('alert transport failed', err, { alert_key: a.key });
  }
}
