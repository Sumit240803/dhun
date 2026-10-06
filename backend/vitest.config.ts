import { defineConfig } from 'vitest/config';
import { loadEnv } from './tests/env.js';

const env = loadEnv();

export default defineConfig({
  test: {
    env: {
      ...env,
      // Point every test at the throwaway database. globalSetup wipes and
      // rebuilds it, so a stray DATABASE_URL can never reach dev data.
      DATABASE_URL: env.TEST_DATABASE_URL ?? '',
      NODE_ENV: 'test',
      // Fixed RTC credentials, so token signing and webhook verification are
      // deterministic and do not depend on whatever is in the developer's .env.
      // Nothing here reaches a real media server — the provider's outbound
      // calls are stubbed in the tests that exercise them.
      LIVEKIT_URL: 'ws://livekit.test:7880',
      LIVEKIT_API_KEY: 'testkey',
      LIVEKIT_API_SECRET: 'test-secret-at-least-32-characters-long',
      // Same reasoning for object storage: fixed values so a key and its URL
      // are predictable, and nothing depends on a developer holding real R2
      // credentials. The provider itself is mocked in media.test.ts, so no
      // request leaves the machine.
      R2_ACCOUNT_ID: 'test-account',
      R2_ACCESS_KEY_ID: 'test-access-key',
      R2_SECRET_ACCESS_KEY: 'test-secret-key',
      R2_BUCKET: 'dhun-media-test',
      R2_PUBLIC_URL: 'https://media.test',
    },
    globalSetup: ['./tests/globalSetup.ts'],
    // These tests share one database and assert on global state, so files must
    // not run in parallel with each other.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
