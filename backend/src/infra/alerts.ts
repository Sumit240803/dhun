// Alerting.
//
// Separate from logging on purpose. A log line is something you read when you go
// looking; an alert is something that finds you. The reconciliation job is
// required to page on mismatch, and "we logged an error" is not paging.
//
// Transports (build-plan M21 slice 3), each optional, all run together:
//
//   · log       always. `alert=true` on a structured line, for any log rule.
//   · Telegram  ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID. A bot
//               message to a phone; the cheapest thing that actually buzzes.
//   · webhook   ALERT_WEBHOOK_URL. Slack-compatible ({ text }); Discord and
//               most chat tools accept the same body ({ content } is sent too).
//
// Three properties, in order:
//
//   1. **Raising an alert never throws and never blocks for long.** Each
//      transport has a 5-second budget and its failure is a warning, not an
//      error: an alert transport that is down must not feed the error-burst
//      check that pages about errors — that loop would page about itself.
//   2. **Repeats are folded.** One key alerts at most once per cooldown (30
//      minutes for a page, 2 hours for a warning); the next one that gets
//      through says how many were folded into it. A burst check that runs
//      every five minutes during an incident must not send twelve messages
//      an hour about the same thing.
//   3. **Nothing secret leaves.** `detail` goes to a third party, so it is
//      passed through the event log's sanitiser — redacted by key name,
//      clipped — before any transport sees it.

import { config } from '../config/index.js';
import { recordEvent, sanitiseMeta } from './eventLog.js';
import { logger } from './logger.js';

export type AlertSeverity = 'page' | 'warn' | 'info';

export interface Alert {
  severity: AlertSeverity;
  /** Stable identifier, so repeats can be deduplicated rather than storming. */
  key: string;
  title: string;
  detail?: Record<string, unknown>;
}

export interface AlertTransport {
  readonly name: string;
  send(alert: Alert & { folded: number }): Promise<void>;
}

const TRANSPORT_TIMEOUT_MS = 5_000;

/** How long a key stays quiet after it alerts. `info` (the daily summary) is never folded. */
const COOLDOWN_MS: Record<AlertSeverity, number> = {
  page: 30 * 60_000,
  warn: 2 * 60 * 60_000,
  info: 0,
};

// ── Transports ───────────────────────────────────────────────────────────────

/**
 * A log line tagged so an alerting rule can match on it. Always present.
 *
 * Marked `skipEventLog`: `alert()` records the alert row itself (kind
 * 'alert'), and the logger hook would otherwise store it a second time.
 */
class LogTransport implements AlertTransport {
  readonly name = 'log';
  async send(a: Alert & { folded: number }): Promise<void> {
    const payload = {
      alert: true,
      severity: a.severity,
      alert_key: a.key,
      folded: a.folded,
      skipEventLog: true,
      ...a.detail,
    };
    if (a.severity === 'page') logger.error(`ALERT ${a.title}`, undefined, payload);
    else if (a.severity === 'warn') logger.warn(`ALERT ${a.title}`, payload);
    else logger.info(`ALERT ${a.title}`, payload);
  }
}

const MARK: Record<AlertSeverity, string> = { page: '🔴 PAGE', warn: '🟠 WARN', info: '🔵 INFO' };

/** The human message, shared by every chat transport. Plain text: no markup to escape. */
export function formatAlert(a: Alert & { folded: number }, env: string, linkBase?: string): string {
  const lines = [`${MARK[a.severity]} · ${env}`, a.title];
  if (a.folded > 0) lines.push(`(${a.folded} more like this were held back since the last message)`);
  const detail = Object.entries(a.detail ?? {}).slice(0, 12);
  if (detail.length) {
    lines.push('');
    for (const [k, v] of detail) {
      const text = typeof v === 'string' ? v : JSON.stringify(v);
      lines.push(`${k}: ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`);
    }
  }
  lines.push('', `key: ${a.key}`);
  if (linkBase) lines.push(`${linkBase.replace(/\/+$/, '')}/admin/events?kind=alert`);
  return lines.join('\n').slice(0, 3_900); // Telegram's limit is 4096
}

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TRANSPORT_TIMEOUT_MS),
  });
  if (!res.ok) {
    // The status only. A body could echo the URL, and the URL is the secret.
    throw new Error(`HTTP ${res.status}`);
  }
}

export class TelegramTransport implements AlertTransport {
  readonly name = 'telegram';
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly env: string,
    private readonly linkBase?: string,
  ) {}
  async send(a: Alert & { folded: number }): Promise<void> {
    await postJson(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      chat_id: this.chatId,
      text: formatAlert(a, this.env, this.linkBase),
      disable_web_page_preview: true,
      // A summary should not wake anyone; a page should.
      disable_notification: a.severity === 'info',
    });
  }
}

export class WebhookTransport implements AlertTransport {
  readonly name = 'webhook';
  constructor(
    private readonly url: string,
    private readonly env: string,
    private readonly linkBase?: string,
  ) {}
  async send(a: Alert & { folded: number }): Promise<void> {
    const text = formatAlert(a, this.env, this.linkBase);
    await postJson(this.url, { text, content: text.slice(0, 2_000) });
  }
}

/** Every transport configured for this process, the log first. */
export function transportsFromConfig(): AlertTransport[] {
  const env = config.alerts.envLabel;
  const out: AlertTransport[] = [new LogTransport()];
  if (config.alerts.telegramBotToken && config.alerts.telegramChatId) {
    out.push(
      new TelegramTransport(config.alerts.telegramBotToken, config.alerts.telegramChatId, env, config.alerts.linkBase),
    );
  }
  if (config.alerts.webhookUrl) {
    out.push(new WebhookTransport(config.alerts.webhookUrl, env, config.alerts.linkBase));
  }
  return out;
}

let transports: AlertTransport[] = transportsFromConfig();

/** Replace every transport. Tests, and a future pager integration. */
export function setAlertTransport(next: AlertTransport | AlertTransport[]): void {
  transports = Array.isArray(next) ? next : [next];
}

// ── Folding repeats ──────────────────────────────────────────────────────────

const lastSent = new Map<string, { at: number; folded: number }>();

/** Tests only. */
export function resetAlertCooldowns(): void {
  lastSent.clear();
}

// ── Raising ──────────────────────────────────────────────────────────────────

/**
 * Raise an alert. Never throws.
 *
 * A failure to alert must not take down the job that was trying to report a
 * problem — that turns one incident into two. Returns whether it was sent or
 * folded into a recent one with the same key.
 */
export async function alert(a: Alert): Promise<'sent' | 'folded'> {
  const detail = sanitiseMeta(a.detail);
  const safe = { ...a, detail };

  // Recorded whatever happens next: the screen should show every time the
  // alarm condition held, including the times the message was folded.
  recordEvent({
    level: a.severity === 'page' ? 'error' : a.severity === 'warn' ? 'warn' : 'info',
    kind: 'alert',
    event: `alert.${a.severity}`,
    message: a.title,
    code: a.key.slice(0, 64),
    meta: { alert_key: a.key, ...detail },
  });

  const now = Date.now();
  const cooldown = COOLDOWN_MS[a.severity];
  const previous = lastSent.get(a.key);
  if (cooldown > 0 && previous && now - previous.at < cooldown) {
    previous.folded += 1;
    return 'folded';
  }
  const folded = previous?.folded ?? 0;
  lastSent.set(a.key, { at: now, folded: 0 });

  await Promise.all(
    transports.map(async (t) => {
      try {
        await t.send({ ...safe, folded });
      } catch (err) {
        // Warn, never error: see property 1 at the top of this file.
        logger.warn('alert transport failed', {
          transport: t.name,
          alert_key: a.key,
          reason: err instanceof Error ? err.message : String(err),
        });
        recordEvent({
          level: 'warn',
          kind: 'alert',
          event: 'alert.transport_failed',
          code: t.name,
          message: `${t.name} did not deliver ${a.key}`,
          meta: { reason: err instanceof Error ? err.message : String(err) },
        });
      }
    }),
  );
  return 'sent';
}
