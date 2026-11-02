// The only way a staff account is made (build-plan M21 slice 6).
//
//   npm run staff -- list
//   npm run staff -- create --email ops@dhunlive.in --name "Ops" --role ops_manager
//   npm run staff -- reset  --email ops@dhunlive.in
//   npm run staff -- revoke --email ops@dhunlive.in --role ops_manager --reason "left"
//
// In a deployed environment, from a root shell on the API host:
//   docker run --rm --env-file /etc/dhun/app.env -v /etc/dhun/db-ca.crt:/etc/dhun/db-ca.crt:ro \
//     "$(sed -n 's/^IMAGE=//p' /etc/dhun/release.env)" staff list
//
// The password is GENERATED, printed once to this terminal, and never stored
// anywhere but as a scrypt hash. Nobody types one in, so nobody types
// "admin123". The API audits staff passwords against known ones at every start
// (src/admin/staffAudit.ts) and pages on a match.
//
// Revoking sets revoked_at; a role row is never deleted (ops/roles.sql revokes
// DELETE). Who could do what, and when it stopped, is part of the audit trail.

import { randomBytes } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { STAFF_ROLES } from '../src/admin/session.js';
import { pool, withTransaction } from '../src/infra/db.js';
import { hashPassword } from '../src/modules/auth/password.js';

type Args = Record<string, string | undefined>;

function parse(argv: string[]): { command: string; args: Args } {
  const [command = 'help', ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag.startsWith('--')) args[flag.slice(2)] = rest[i + 1]?.startsWith('--') ? 'true' : rest[++i];
  }
  return { command, args };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

/** 24 characters from a 64-symbol alphabet: 144 bits, and no character a terminal mangles. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

function need(args: Args, key: string): string {
  const value = args[key]?.trim();
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function role(args: Args): string {
  const r = need(args, 'role');
  if (!STAFF_ROLES.includes(r)) throw new Error(`--role must be one of: ${STAFF_ROLES.join(', ')}`);
  return r;
}

function email(args: Args): string {
  const e = need(args, 'email').toLowerCase();
  if (!EMAIL.test(e)) throw new Error('--email is not an email address');
  return e;
}

async function list(): Promise<void> {
  const { rows } = await pool.query<{ email: string; name: string | null; roles: string[]; granted: Date }>(
    `SELECT u.email, p.display_name AS name, array_agg(r.role_code ORDER BY r.role_code) AS roles,
            min(r.granted_at) AS granted
       FROM role_assignments r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE r.revoked_at IS NULL AND r.role_code = ANY($1::text[])
      GROUP BY u.email, p.display_name
      ORDER BY granted`,
    [STAFF_ROLES],
  );
  if (rows.length === 0) console.log('No staff accounts.');
  for (const r of rows) console.log(`${r.email ?? '(no email)'}\t${r.name ?? ''}\t${r.roles.join(', ')}`);
}

async function create(args: Args): Promise<void> {
  const address = email(args);
  const roleCode = role(args);
  const name = need(args, 'name').slice(0, 40);

  const result = await withTransaction(async (c) => {
    const existing = await c.query<{ id: string }>('SELECT id FROM users WHERE lower(email) = $1', [address]);
    let userId = existing.rows[0]?.id;
    let password: string | null = null;

    if (!userId) {
      userId = uuidv7();
      password = generatePassword();
      await c.query(
        "INSERT INTO users (id, email, password_hash, status) VALUES ($1, $2, $3, 'active')",
        [userId, address, await hashPassword(password)],
      );
      await c.query('INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2)', [userId, name]);
    }

    const held = await c.query(
      `SELECT 1 FROM role_assignments
        WHERE user_id = $1 AND role_code = $2 AND scope_type = 'global' AND revoked_at IS NULL`,
      [userId, roleCode],
    );
    if (held.rowCount === 0) {
      await c.query(
        `INSERT INTO role_assignments (id, user_id, role_code, scope_type, reason)
         VALUES ($1, $2, $3, 'global', $4)`,
        [uuidv7(), userId, roleCode, `granted by scripts/staff.ts`],
      );
    }
    return { password, alreadyHeld: held.rowCount !== 0 };
  });

  if (result.password) {
    console.log(`Created ${address} as ${roleCode}.`);
    console.log(`Password (shown once, give it over a private channel): ${result.password}`);
  } else {
    console.log(`${address} already exists; ${result.alreadyHeld ? 'already holds' : 'now holds'} ${roleCode}. Password unchanged.`);
  }
}

async function reset(args: Args): Promise<void> {
  const address = email(args);
  const password = generatePassword();
  const { rowCount } = await pool.query('UPDATE users SET password_hash = $2 WHERE lower(email) = $1', [
    address,
    await hashPassword(password),
  ]);
  if (!rowCount) throw new Error(`no account with email ${address}`);
  // Every app session ends too; the admin cookie re-reads roles on each request
  // and expires within eight hours.
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE lower(email) = $1)`,
    [address],
  );
  console.log(`New password for ${address} (shown once): ${password}`);
}

async function revoke(args: Args): Promise<void> {
  const address = email(args);
  const roleCode = role(args);
  const reason = need(args, 'reason').slice(0, 200);
  const { rowCount } = await pool.query(
    `UPDATE role_assignments SET revoked_at = now(), reason = $3
      WHERE revoked_at IS NULL AND role_code = $2
        AND user_id = (SELECT id FROM users WHERE lower(email) = $1)`,
    [address, roleCode, reason],
  );
  console.log(rowCount ? `Revoked ${roleCode} from ${address}.` : `${address} did not hold ${roleCode}.`);
}

const HELP = `staff list
staff create --email <address> --name <display name> --role <${STAFF_ROLES.join('|')}>
staff reset  --email <address>
staff revoke --email <address> --role <role> --reason <why>`;

async function main(): Promise<void> {
  const { command, args } = parse(process.argv.slice(2));
  switch (command) {
    case 'list':
      return list();
    case 'create':
      return create(args);
    case 'reset':
      return reset(args);
    case 'revoke':
      return revoke(args);
    default:
      console.log(HELP);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
