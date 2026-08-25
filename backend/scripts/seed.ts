// Development seed.
//
// Fills the tables the app reads so the feed, the message list and the profile
// have something to show. Safe to run repeatedly: every insert is keyed on a
// deterministic id and upserts, so this never doubles the data or drifts.
//
// ⛔ Refuses to run against production. A seed script that can be pointed at a
// live database eventually is — usually at 2am, by someone who copied the
// wrong DATABASE_URL — and the users it invents are indistinguishable from
// real ones once they have ledger rows.
//
//   npm run seed
//   npm run seed -- --clear    remove everything this script created

import { uuidv7 } from 'uuidv7';
import { config } from '../src/config/index.js';
import { pool } from '../src/infra/db.js';

if (config.nodeEnv === 'production') {
  console.error('seed: refusing to run with NODE_ENV=production');
  process.exit(1);
}

/**
 * Stable ids from a name, so re-running updates the same rows.
 *
 * uuidv7() is time-ordered and would produce a new id on every run, which is
 * exactly what makes a seed script pile up duplicates.
 */
function idFor(name: string): string {
  const hex = [...name].reduce((acc, ch) => (acc * 33 + ch.charCodeAt(0)) >>> 0, 5381)
    .toString(16)
    .padStart(8, '0');
  return `00000000-0000-4000-8000-0000${hex}`;
}

interface SeedHost {
  key: string;
  name: string;
  title: string;
  tag: string;
  viewers: number;
  seats: number | null;
  video: boolean;
}

const HOSTS: SeedHost[] = [
  { key: 'riya', name: 'Riya', title: 'Evening ghazals', tag: 'singing', viewers: 12_040, seats: null, video: true },
  { key: 'ankit', name: 'Ankit', title: 'PS5 ranked grind', tag: 'esports', viewers: 20_610, seats: null, video: true },
  { key: 'meera', name: 'Meera', title: 'Chai aur baatein', tag: 'chatting', viewers: 9_120, seats: null, video: true },
  { key: 'vikram', name: 'Vikram', title: 'Late night gaming', tag: 'gaming', viewers: 17_300, seats: null, video: true },
  { key: 'sana', name: 'Sana', title: 'Learn to dance', tag: 'dancing', viewers: 4_720, seats: null, video: true },
  { key: 'dev', name: 'Dev', title: 'Open mic, no judging', tag: 'friends', viewers: 860, seats: null, video: false },
  { key: 'lisha', name: 'LISHA', title: 'Dance party', tag: 'dancing', viewers: 807, seats: 10, video: true },
  { key: 'gemi', name: 'Gemi', title: 'Antakshari night', tag: 'singing', viewers: 2_310, seats: 16, video: true },
  { key: 'barbie', name: 'Barbie', title: 'Chill room', tag: 'chatting', viewers: 443, seats: 7, video: false },
  { key: 'sabita', name: 'Sabita', title: 'Naye dost', tag: 'friends', viewers: 629, seats: 6, video: true },
  { key: 'dilli', name: 'Dilli Se', title: 'Delhi adda', tag: 'chatting', viewers: 1_150, seats: 9, video: false },
];

const BANNERS = [
  {
    key: 'banner-ranking',
    title: 'Gifting Points Ranking',
    subtitle: 'Top hosts this week share a ₹2,00,000 pool',
    endsAt: "now() + interval '6 days'",
    action: 'ranking',
    theme: 'gold',
    order: 0,
  },
  {
    key: 'banner-rewards',
    title: 'New here? Collect your rewards',
    subtitle: 'Daily check-in, first follow and more — free coins',
    endsAt: "now() + interval '7 days'",
    action: 'rewards',
    theme: 'rose',
    order: 1,
  },
  {
    key: 'banner-starter',
    title: 'Starter pack — ₹19',
    subtitle: '2,000 coins and 3,300 gems, once per account',
    endsAt: 'NULL',
    action: 'topup',
    theme: 'violet',
    order: 2,
  },
];

const SEEDED_IDS = [
  ...HOSTS.map((host) => idFor(host.key)),
  ...HOSTS.map((host) => idFor(`room:${host.key}`)),
  ...BANNERS.map((banner) => idFor(banner.key)),
];

async function clear(): Promise<void> {
  const userIds = HOSTS.map((host) => idFor(host.key));

  // Order matters: children first, or the foreign keys refuse.
  await pool.query('DELETE FROM messages WHERE thread_id = ANY($1::uuid[])', [
    [idFor('thread:income'), idFor('thread:security')],
  ]);
  await pool.query('DELETE FROM thread_participants WHERE thread_id = ANY($1::uuid[])', [
    [idFor('thread:income'), idFor('thread:security')],
  ]);
  await pool.query('DELETE FROM message_threads WHERE id = ANY($1::uuid[])', [
    [idFor('thread:income'), idFor('thread:security')],
  ]);
  await pool.query('DELETE FROM rooms WHERE host_user_id = ANY($1::uuid[])', [userIds]);
  await pool.query('DELETE FROM follows WHERE followee_user_id = ANY($1::uuid[])', [userIds]);
  await pool.query('DELETE FROM banners WHERE id = ANY($1::uuid[])', [
    BANNERS.map((banner) => idFor(banner.key)),
  ]);
  await pool.query('DELETE FROM user_profiles WHERE user_id = ANY($1::uuid[])', [userIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);

  console.log(`seed: cleared ${SEEDED_IDS.length} seeded rows`);
}

async function seed(): Promise<void> {
  for (const host of HOSTS) {
    const userId = idFor(host.key);

    // Seeded hosts are REGISTERED with a verified phone. A guest cannot host,
    // and the 18+ gate is enforced on the profile — so a seed that skipped
    // either would be a row the real code could never produce.
    await pool.query(
      `INSERT INTO users (id, status, phone_e164, phone_verified_at)
            VALUES ($1, 'active', $2, now())
       ON CONFLICT (id) DO UPDATE SET status = 'active'`,
      [userId, `+9199${String(Math.abs(hash(host.key))).padStart(8, '0').slice(0, 8)}`],
    );

    await pool.query(
      `INSERT INTO user_profiles (user_id, display_name, country, date_of_birth, gender)
            VALUES ($1, $2, 'IN', date '1998-04-12', 'undisclosed')
       ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [userId, host.name],
    );

    await pool.query(
      `INSERT INTO rooms (id, host_user_id, title, tag, country, is_video,
                          seat_capacity, seats_taken, viewer_count, started_at)
            VALUES ($1, $2, $3, $4, 'IN', $5, $6, $7, $8, now() - interval '20 minutes')
       ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title,
              viewer_count = EXCLUDED.viewer_count,
              seats_taken = EXCLUDED.seats_taken,
              ended_at = NULL`,
      [
        idFor(`room:${host.key}`),
        userId,
        host.title,
        host.tag,
        host.video,
        host.seats,
        host.seats === null ? 0 : Math.max(1, Math.floor(host.seats * 0.6)),
        host.viewers,
      ],
    );
  }

  for (const banner of BANNERS) {
    await pool.query(
      `INSERT INTO banners (id, title, subtitle, ends_at, action, theme, sort_order, is_active)
            VALUES ($1, $2, $3, ${banner.endsAt}, $4, $5, $6, true)
       ON CONFLICT (id) DO UPDATE
          SET title = EXCLUDED.title,
              subtitle = EXCLUDED.subtitle,
              ends_at = EXCLUDED.ends_at,
              is_active = true`,
      [idFor(banner.key), banner.title, banner.subtitle, banner.action, banner.theme, banner.order],
    );
  }

  console.log(`seed: ${HOSTS.length} hosts and rooms, ${BANNERS.length} banners`);
}

/**
 * Gives the signed-in user something to look at.
 *
 * Run separately because it needs a real account: the message threads and the
 * Following feed are per-user, and seeding them for nobody would leave both
 * empty on the one screen you are trying to check.
 */
async function seedForUser(userId: string): Promise<void> {
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
  if (rowCount === 0) {
    console.error(`seed: no user ${userId}`);
    process.exit(1);
  }

  // Follow the first three hosts, so Following is not empty.
  for (const host of HOSTS.slice(0, 3)) {
    await pool.query(
      `INSERT INTO follows (follower_user_id, followee_user_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, idFor(host.key)],
    );
  }

  const threads = [
    {
      key: 'thread:income',
      title: 'Income Reminder',
      accent: 'money',
      body: 'Congratulations on completing Log in daily. 100 coins have been added to your wallet.',
    },
    {
      key: 'thread:security',
      title: 'Account Security Center',
      accent: 'security',
      body: 'Your account was signed in on a new device. If this was not you, secure your account.',
    },
  ];

  for (const thread of threads) {
    const threadId = idFor(thread.key);

    await pool.query(
      `INSERT INTO message_threads (id, kind, title, accent)
            VALUES ($1, 'official', $2, $3)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title`,
      [threadId, thread.title, thread.accent],
    );

    // last_read_at NULL, so both threads arrive unread — which is the state the
    // badge and the filter chips need in order to be checkable at all.
    await pool.query(
      `INSERT INTO thread_participants (thread_id, user_id, last_read_at)
            VALUES ($1, $2, NULL) ON CONFLICT DO NOTHING`,
      [threadId, userId],
    );

    await pool.query(
      `INSERT INTO messages (id, thread_id, sender_user_id, body)
            VALUES ($1, $2, NULL, $3)
       ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body`,
      [idFor(`message:${thread.key}`), threadId, thread.body],
    );
  }

  // Two people looked at the profile, both unseen — so "Visitors" shows a count.
  for (const host of HOSTS.slice(3, 5)) {
    await pool.query(
      `INSERT INTO profile_visits (profile_user_id, viewer_user_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, idFor(host.key)],
    );
  }

  console.log(`seed: follows, 2 official threads and 2 visitors for ${userId}`);
}

function hash(value: string): number {
  return [...value].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--clear')) {
    await clear();
    return;
  }

  await seed();

  const forUser = args.find((arg) => arg.startsWith('--user='));
  if (forUser) await seedForUser(forUser.slice('--user='.length));
  else console.log('seed: pass --user=<uuid> to also seed follows, messages and visitors');
}

main()
  .catch((err) => {
    console.error('seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
