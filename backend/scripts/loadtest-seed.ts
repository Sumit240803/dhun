// Load test, part 1: accounts and a live room (build-plan M21 slice 6).
//
//   npm run loadtest:seed -- --senders 30 --hosts 10 > loadtest.json
//
// On staging, from a root shell on the API host (the database is private):
//   docker run --rm --env-file /etc/dhun/app.env -v /etc/dhun/db-ca.crt:/etc/dhun/db-ca.crt:ro \
//     "$(sed -n 's/^IMAGE=//p' /etc/dhun/release.env)" loadtest-seed --senders 30 > loadtest.json
//
// Creates H hosts, each with a live party room, and N adult senders with coins, all
// through the real ledger (free-coin grants, never a balance written by hand),
// and prints JSON: the API's access tokens for each, valid 15 minutes. Part 2
// (scripts/loadtest-gifts.ts) reads it from any machine.
//
// ⛔ Refuses to run where NODE_ENV=production. The accounts it makes are real
// rows in an append-only ledger and cannot be removed.

import { randomUUID } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { config } from '../src/config/index.js';
import { pool, withTransaction } from '../src/infra/db.js';
import { closeRoomBus } from '../src/infra/roomBus.js';
// Tooling reaching past a module's index: issueTokenPair is deliberately not
// public, because nothing in the app should mint a session without proof.
import { issueTokenPair } from '../src/modules/auth/tokens.js';
import { ECONOMY, freeCoinGrantLegs, postTransaction } from '../src/modules/economy/index.js';

if (config.isProduction) {
  console.error('loadtest-seed refuses to run in production.');
  process.exit(1);
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > -1 ? Number(process.argv[i + 1]) : fallback;
  if (!Number.isInteger(v) || v < 1 || v > 500) throw new Error(`--${name} must be 1..500`);
  return v;
}

/** One run's accounts share a prefix, so they are easy to find and ignore later. */
const RUN = uuidv7().slice(-8);

async function makeAdult(name: string): Promise<{ id: string; accessToken: string }> {
  const id = uuidv7();
  const deviceId = `loadtest-${RUN}-${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO users (id, status, phone_e164, phone_verified_at) VALUES ($1, 'active', $2, now())`,
    // +91 99999 then a random tail: outside every real Indian mobile range in use.
    [id, `+9199999${String(Math.floor(Math.random() * 100_000)).padStart(5, '0')}${Math.floor(Math.random() * 10)}`.slice(0, 13)],
  );
  await pool.query(
    `INSERT INTO user_profiles (user_id, display_name, country, date_of_birth, gender)
     VALUES ($1, $2, 'IN', date '1995-06-15', 'undisclosed')`,
    [id, name],
  );
  const tokens = await withTransaction((c) => issueTokenPair(c, id, 'active', deviceId));
  return { id, accessToken: tokens.accessToken };
}

async function main(): Promise<void> {
  const senders = arg('senders', 30);
  const coinsEach = arg('coins-thousands', 500) * 1_000;

  // Several rooms, because the cost that matters is per HOST: every gift to one
  // host updates that host's balance row, so gifts to one host serialise.
  // --hosts 1 measures a single hot room; --hosts 10 the platform spread.
  const rooms: { roomId: string; hostId: string }[] = [];
  for (let h = 0; h < arg('hosts', 10); h++) {
    const host = await makeAdult(`Loadtest Host ${RUN} ${h + 1}`);
    const roomId = uuidv7();
    await pool.query(
      `INSERT INTO rooms (id, host_user_id, title, tag, country, is_video, seat_capacity, seats_taken, started_at)
       VALUES ($1, $2, $3, 'chatting', 'IN', false, 8, 0, now())`,
      [roomId, host.id, `Loadtest ${RUN} ${h + 1}`],
    );
    rooms.push({ roomId, hostId: host.id });
  }

  const out: { id: string; accessToken: string }[] = [];
  for (let i = 0; i < senders; i++) {
    const s = await makeAdult(`Loadtest ${RUN} ${i + 1}`);
    await postTransaction({
      txnType: 'free_coin_grant',
      idempotencyKey: `loadtest:${RUN}:${s.id}`,
      identity: { loadtest: RUN, user_id: s.id },
      rates: { faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee, pointsPerRupee: ECONOMY.pointsPerRupee },
      legs: freeCoinGrantLegs({ userId: s.id, coins: coinsEach }),
      memo: `loadtest ${RUN}: starting balance`,
    });
    out.push(s);
  }

  process.stdout.write(
    `${JSON.stringify({ run: RUN, rooms, senders: out, issuedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRoomBus().catch(() => undefined);
    await pool.end();
  });
