// Minimal migration runner: applies numbered .sql files in order, once each.
//
// Deliberately not a library. The migrations stay pure SQL so a CA or auditor
// can read them, and there is no framework between us and the DDL.
//
//   npm run migrate              apply pending migrations
//   npm run migrate:status       list applied / pending
//   npm run db:reset             drop everything and re-apply (DEV ONLY)
import { readdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 001_, 002_, … lexical sort is chronological by convention
}

async function ensureMigrationsTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      checksum    text        NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function applied(): Promise<Map<string, string>> {
  const { rows } = await client.query<{ filename: string; checksum: string }>(
    'SELECT filename, checksum FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

async function status() {
  const done = await applied();
  for (const file of migrationFiles()) {
    console.log(`${done.has(file) ? '  applied' : '  PENDING'}  ${file}`);
  }
}

async function migrate() {
  const done = await applied();

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = sha256(sql);
    const previous = done.get(file);

    if (previous) {
      // An edited migration means someone changed history — refuse rather than
      // silently diverge from what production actually ran.
      if (previous !== checksum) {
        throw new Error(
          `${file} was modified after being applied.\n` +
            `Migrations are immutable — add a new one instead.`,
        );
      }
      continue;
    }

    process.stdout.write(`  applying ${file} … `);
    // Each migration runs in its own transaction: it either lands whole or not at all.
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ]);
      await client.query('COMMIT');
      console.log('ok');
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      throw err;
    }
  }
}

// Wipes the schema and re-applies from scratch. The ledger's append-only trigger
// makes row-level cleanup impossible by design, so a reset is the only way back
// to a clean database. Refuses to run outside development.
async function reset() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset is refused in production');
  }
  console.log('  dropping schema public …');
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  await ensureMigrationsTable();
  await migrate();
}

async function main() {
  await client.connect();
  await ensureMigrationsTable();
  if (process.argv.includes('--status')) await status();
  else if (process.argv.includes('--reset')) await reset();
  else await migrate();
  await client.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
