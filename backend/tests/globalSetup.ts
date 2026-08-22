// Rebuilds the test database from migrations once per run.
//
// Not a mock and not an in-memory shim: the ledger's guarantees live in
// triggers, deferred constraints and row locks, so a test against anything but
// real Postgres would prove nothing.
import { execFileSync } from 'child_process';
import { loadEnv } from './env.js';

export default function setup() {
  const env = loadEnv();
  const url = env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set — see .env.example');

  execFileSync('node', ['--import', 'tsx', 'scripts/migrate.ts', '--reset'], {
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' },
    stdio: 'inherit',
  });
}
