// Load test, part 2: the gift path at a fixed rate (build-plan M21 slice 6).
//
//   npx tsx scripts/loadtest-gifts.ts --base https://api-staging.dhun.live \
//     --fixture loadtest.json --rate 100 --seconds 60 --p95 200
//
// Reads the accounts from loadtest-seed, then sends gifts at a FIXED arrival
// rate — open-loop, not "as fast as the last one returns", because real
// gifters do not wait for each other and a closed loop hides queueing by
// slowing itself down. Each request is a real money transaction: one ledger
// transaction, idempotency key, the room broadcast.
//
// Prints p50/p95/p99 and the error codes, and exits 1 if p95 is over the
// target or any request failed. The M21 exit: p95 under 200ms at 100 gifts/s.
//
// Senders rotate so no one passes the per-user gift limit (300 a minute). One
// load machine is one IP, so staging must allow it through the per-IP flood
// ceiling: GLOBAL_RATE_LIMIT_PER_MINUTE in its app_settings (infra/).

import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

interface Fixture {
  run: string;
  rooms: { roomId: string; hostId: string }[];
  senders: { id: string; accessToken: string }[];
}

function flag(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > -1 ? process.argv[i + 1] : fallback;
  if (v === undefined) throw new Error(`--${name} is required`);
  return v;
}

const base = flag('base', 'http://localhost:3000').replace(/\/+$/, '');
const fixture = JSON.parse(readFileSync(flag('fixture', 'loadtest.json'), 'utf8')) as Fixture;
const rate = Number(flag('rate', '100'));
const seconds = Number(flag('seconds', '60'));
const targetP95 = Number(flag('p95', '200'));
const giftId = flag('gift', 'heart');

const PER_USER_PER_MINUTE = 300;
const needed = Math.ceil((rate * 60) / (PER_USER_PER_MINUTE * 0.8));
if (fixture.senders.length < needed) {
  console.error(`${rate} gifts/s needs at least ${needed} senders under the per-user limit; the fixture has ${fixture.senders.length}.`);
  process.exit(1);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function priceOf(gift: string): Promise<number> {
  const res = await fetch(`${base}/v1/catalog/gifts`);
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`);
  const body = (await res.json()) as { gifts: { id: string; coinPrice: number }[] };
  const found = body.gifts.find((g) => g.id === gift);
  if (!found) throw new Error(`no gift "${gift}" in the catalog`);
  return found.coinPrice;
}

async function main(): Promise<void> {
  const price = await priceOf(giftId);
  const latencies: number[] = [];
  /** Latencies by the second the request was SENT in: stalls show as bad seconds. */
  const bySecond: number[][] = [];
  const codes = new Map<string, number>();
  const inflight: Promise<void>[] = [];
  const total = Math.round(rate * seconds);
  const intervalMs = 1_000 / rate;
  const started = performance.now();

  console.log(`${total} gifts of ${giftId} (${price} coins) at ${rate}/s for ${seconds}s across ${fixture.rooms.length} room(s)`);

  for (let i = 0; i < total; i++) {
    // Open loop: wait for this request's scheduled moment, never for the last response.
    const due = started + i * intervalMs;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const sender = fixture.senders[i % fixture.senders.length];
    const room = fixture.rooms[i % fixture.rooms.length];
    inflight.push(
      (async () => {
        const t0 = performance.now();
        let code = 'NETWORK_ERROR';
        try {
          const res = await fetch(`${base}/v1/gifts/send`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sender.accessToken}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': randomUUID(),
              'X-Trace-Id': `loadtest-${fixture.run}-${i}`,
            },
            body: JSON.stringify({
              roomId: room.roomId,
              recipientId: room.hostId,
              giftId,
              quantity: 1,
              expectedCoinPrice: price,
            }),
          });
          code = res.ok ? 'OK' : (((await res.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code ?? `HTTP_${res.status}`);
        } catch {
          // counted as NETWORK_ERROR
        }
        latencies.push(performance.now() - t0);
        const second = Math.floor((t0 - started) / 1_000);
        (bySecond[second] ??= []).push(performance.now() - t0);
        codes.set(code, (codes.get(code) ?? 0) + 1);
      })(),
    );
  }
  await Promise.all(inflight);

  const elapsed = (performance.now() - started) / 1_000;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (q: number) => `${percentile(sorted, q).toFixed(0)}ms`;
  const failures = total - (codes.get('OK') ?? 0);

  console.log(`\nsent ${total} in ${elapsed.toFixed(1)}s (${(total / elapsed).toFixed(1)}/s achieved)`);
  console.log(`latency  p50 ${p(50)}  p95 ${p(95)}  p99 ${p(99)}  max ${p(100)}`);
  console.log(`results  ${[...codes.entries()].map(([c, n]) => `${c} ${n}`).join('  ')}`);
  // A steady p95 is a capacity limit; a few terrible seconds are a stall
  // (a pause, a lock queue, a cache rebuild) — different causes, different fixes.
  console.log(
    `p95 by second  ${bySecond
      .map((s) => (s ? percentile([...s].sort((a, b) => a - b), 95).toFixed(0) : '-'))
      .join(' ')}`,
  );

  const p95 = percentile(sorted, 95);
  const pass = p95 <= targetP95 && failures === 0;
  console.log(pass ? `\nPASS: p95 ${p95.toFixed(0)}ms ≤ ${targetP95}ms, no failures` : `\nFAIL: p95 ${p95.toFixed(0)}ms (target ${targetP95}ms), ${failures} failed`);
  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
