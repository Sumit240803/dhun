// Alert transports (build-plan M21 slice 3): what reaches a phone, how often,
// and what never leaves the server.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alert,
  formatAlert,
  resetAlertCooldowns,
  setAlertTransport,
  TelegramTransport,
  transportsFromConfig,
  WebhookTransport,
  type Alert,
  type AlertTransport,
} from '../src/infra/alerts.js';
import { pool } from '../src/infra/db.js';
import { discardQueuedEvents, flushEvents, recordEvent } from '../src/infra/eventLog.js';
import { dailySummary, dailySummaryJob } from '../src/workers/jobs/events.js';
import { runJobOnce } from '../src/workers/scheduler.js';
import { closePool, resetLedger } from './helpers.js';

type Sent = Alert & { folded: number };

function recorder(): { transport: AlertTransport; sent: Sent[] } {
  const sent: Sent[] = [];
  return { sent, transport: { name: 'test', send: async (a) => void sent.push(a) } };
}

const silence = () => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
};

async function alertRows(event?: string) {
  await flushEvents();
  const { rows } = await pool.query<{ event: string; level: string; code: string; meta: Record<string, unknown> }>(
    `SELECT event, level, code, meta FROM system_events WHERE kind = 'alert' ${event ? 'AND event = $1' : ''} ORDER BY occurred_at`,
    event ? [event] : [],
  );
  return rows;
}

beforeEach(async () => {
  await resetLedger();
  discardQueuedEvents();
  resetAlertCooldowns();
});

afterEach(() => {
  vi.restoreAllMocks();
  setAlertTransport(transportsFromConfig());
});

afterAll(async () => {
  await flushEvents();
  await closePool();
});

describe('the message', () => {
  it('names the environment, the severity, the detail and the key', () => {
    const text = formatAlert(
      { severity: 'page', key: 'job:nightly_reconciliation', title: 'Reconciliation failed', detail: { mismatches: 3 }, folded: 0 },
      'staging',
      'https://api-staging.dhun.live/',
    );
    expect(text.split('\n')[0]).toBe('🔴 PAGE · staging');
    expect(text).toContain('Reconciliation failed');
    expect(text).toContain('mismatches: 3');
    expect(text).toContain('key: job:nightly_reconciliation');
    expect(text).toContain('https://api-staging.dhun.live/admin/events?kind=alert');
    expect(text).not.toContain('held back');
  });

  it('says how many were folded into it', () => {
    const text = formatAlert({ severity: 'warn', key: 'k', title: 't', folded: 4 }, 'prod');
    expect(text).toContain('4 more like this were held back');
  });
});

describe('the transports', () => {
  it('Telegram posts the message to the bot API, quietly for a summary', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const t = new TelegramTransport('123:abc', '-1001', 'staging');

    await t.send({ severity: 'page', key: 'k', title: 'Down', folded: 0 });
    await t.send({ severity: 'info', key: 'daily_summary', title: 'All clear', folded: 0 });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    const page = JSON.parse(init.body as string);
    expect(page).toMatchObject({ chat_id: '-1001', disable_notification: false });
    expect(page.text).toContain('Down');
    expect(JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string).disable_notification).toBe(true);
  });

  it('the webhook sends both text and content, and reports a failure by status only', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('invalid_token https://hooks.example/secret', { status: 403 }));
    const t = new WebhookTransport('https://hooks.example/secret', 'prod');

    await t.send({ severity: 'warn', key: 'k', title: 'Slow', folded: 0 });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text).toContain('Slow');
    expect(body.content).toContain('Slow');

    const failure = await t.send({ severity: 'warn', key: 'k', title: 'Slow', folded: 0 }).catch((e: Error) => e);
    expect((failure as Error).message).toBe('HTTP 403');
  });

  it('with nothing configured, only the log transport runs', () => {
    expect(transportsFromConfig().map((t) => t.name)).toEqual(['log']);
  });
});

describe('raising', () => {
  it('folds a repeat inside the cooldown, then reports how many were folded', async () => {
    silence();
    const { transport, sent } = recorder();
    setAlertTransport(transport);
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(1_000_000);
    expect(await alert({ severity: 'page', key: 'outbox:stalled', title: 'Outbox stalled' })).toBe('sent');
    now.mockReturnValue(1_000_000 + 5 * 60_000);
    expect(await alert({ severity: 'page', key: 'outbox:stalled', title: 'Outbox stalled' })).toBe('folded');
    expect(await alert({ severity: 'page', key: 'outbox:stalled', title: 'Outbox stalled' })).toBe('folded');
    // A different key is never folded into this one.
    expect(await alert({ severity: 'page', key: 'other', title: 'Other' })).toBe('sent');

    now.mockReturnValue(1_000_000 + 31 * 60_000);
    expect(await alert({ severity: 'page', key: 'outbox:stalled', title: 'Outbox stalled' })).toBe('sent');

    expect(sent.map((s) => [s.key, s.folded])).toEqual([
      ['outbox:stalled', 0],
      ['other', 0],
      ['outbox:stalled', 2],
    ]);
    // Every occurrence is still on the screen, folded or not.
    expect((await alertRows('alert.page')).filter((r) => r.code === 'outbox:stalled')).toHaveLength(4);
  });

  it('never folds the daily summary', async () => {
    const { transport, sent } = recorder();
    setAlertTransport(transport);
    await alert({ severity: 'info', key: 'daily_summary', title: 'a' });
    await alert({ severity: 'info', key: 'daily_summary', title: 'b' });
    expect(sent).toHaveLength(2);
  });

  it('redacts secrets before any transport sees them', async () => {
    silence();
    const { transport, sent } = recorder();
    setAlertTransport(transport);
    await alert({
      severity: 'page',
      key: 'leak-test',
      title: 'Leak test',
      detail: { authkey: 'MSG91-SECRET', databaseUrlPassword: 'pw', job: 'x' },
    });
    expect(sent[0].detail).toEqual({ authkey: '[redacted]', databaseUrlPassword: '[redacted]', job: 'x' });
    expect(JSON.stringify(await alertRows())).not.toContain('MSG91-SECRET');
  });

  it('a transport that fails neither throws nor stops the others, and is recorded as a warning', async () => {
    silence();
    const { transport, sent } = recorder();
    setAlertTransport([{ name: 'broken', send: async () => Promise.reject(new Error('HTTP 502')) }, transport]);

    await expect(alert({ severity: 'page', key: 'k', title: 't' })).resolves.toBe('sent');
    expect(sent).toHaveLength(1);

    const failures = await alertRows('alert.transport_failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].level).toBe('warn');
    expect(failures[0].code).toBe('broken');
    // Not an error: a failing pager must not feed the burst check that pages.
    await flushEvents();
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM system_events WHERE level = 'error' AND kind = 'error'");
    expect(rows[0].n).toBe(0);
  });
});

describe('the daily summary', () => {
  // Job history is not part of resetLedger: other suites read it across cases.
  beforeEach(async () => {
    await pool.query('DELETE FROM reconciliation_checks');
    await pool.query('DELETE FROM job_runs');
  });

  it('counts the day from the tables that already hold it', async () => {
    silence();
    for (let i = 0; i < 3; i++) recordEvent({ level: 'error', kind: 'error', event: 'error.same_bug' });
    recordEvent({ level: 'warn', kind: 'security', event: 'security.rate_limited' });
    await flushEvents();
    await pool.query(
      `INSERT INTO job_runs (job, status, finished_at) VALUES ('purge_otp_challenges', 'failed', now())`,
    );

    const s = await dailySummary();
    expect(s.errors).toBe(3);
    expect(s.warnings).toBe(1);
    expect(s.topErrors).toEqual([{ event: 'error.same_bug', count: 3 }]);
    expect(s.failedJobs).toEqual([{ job: 'purge_otp_challenges', count: 1 }]);
    expect(s.outbox.pending).toBe(0);
  });

  it('sends every morning, all clear or not', async () => {
    silence();
    const { transport, sent } = recorder();
    setAlertTransport(transport);

    await runJobOnce(dailySummaryJob);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ severity: 'info', key: 'daily_summary', title: 'Daily summary: all clear' });
    expect(sent[0].detail).toMatchObject({ errors_24h: 0, failed_jobs: 'none', top_errors: 'none' });

    recordEvent({ level: 'error', kind: 'error', event: 'error.boom' });
    await flushEvents();
    await runJobOnce(dailySummaryJob);
    expect(sent[1].title).toBe('Daily summary: needs a look');
  });
});
