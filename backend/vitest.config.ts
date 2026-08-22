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
    },
    globalSetup: ['./tests/globalSetup.ts'],
    // These tests share one database and assert on global state, so files must
    // not run in parallel with each other.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
