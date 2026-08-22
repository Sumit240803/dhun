import { readFileSync } from 'fs';

/**
 * Minimal .env reader.
 *
 * Needed in two places that do not share environment: vitest.config.ts builds
 * `test.env` for the worker processes, while globalSetup runs in the main
 * process and gets none of it.
 */
export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    // No .env — CI supplies real environment variables instead.
  }
  return { ...out, ...process.env } as Record<string, string>;
}
