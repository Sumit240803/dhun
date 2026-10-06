// Test accounts: agencies, agents, hosts, and users with money.
//
// `seed.ts` fills the FEED — display-only hosts and rooms, nobody you can sign
// in as. This fills the ROLES: real accounts, created through the real service
// functions, that you can log into and act as.
//
// Everything goes through the module APIs rather than INSERTs, so the ledger
// balances, the dated links are consistent, and every invariant the tests prove
// holds here too. A seed that wrote balances directly would be a database the
// real code could never have produced — which is the one thing a test fixture
// must never be.
//
// ⛔ Refuses to run against production.
//
//   npm run seed:testers
//
// NOT re-runnable, and deliberately so: the ledger is append-only, so seeded
// users who have earned or spent CANNOT be deleted. To start over:
//
//   npm run db:reset && npm run seed && npm run seed:testers
//
// Signing in: every account below has a phone number. Request an OTP for it and
// the development provider returns the code in the response — the app shows it
// on screen. No SMS account needed.

import { randomUUID } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { config } from '../src/config/index.js';
import { pool } from '../src/infra/db.js';
import { closeRoomBus } from '../src/infra/roomBus.js';
import {
  answerAgentInvite,
  answerRequest,
  applyToAgent,
  applyToQuit,
  closePeriod,
  confirmPrepay,
  createAgency,
  inviteAgent,
  istMonth,
  listAgents,
  openPeriod,
  previousMonth,
  recordPrepay,
  setCoinTrading,
  transfer,
} from '../src/modules/agency/index.js';
import {
  conversionLegs,
  ECONOMY,
  freeCoinGrantLegs,
  postTransaction,
} from '../src/modules/economy/index.js';
import { sendGift, type GiftQuantity } from '../src/modules/gifting/index.js';

if (config.nodeEnv === 'production') {
  console.error('seed:testers — refusing to run with NODE_ENV=production');
  process.exit(1);
}

// ── Accounts ────────────────────────────────────────────────────────────────

/** One block of numbers, so a tester can read the list and know what to type. */
let phoneCounter = 0;
const nextPhone = () => `+9190000${String(++phoneCounter).padStart(5, '0')}`;

interface Account {
  id: string;
  publicId: number;
  phone: string;
  name: string;
  role: string;
}

const accounts: Account[] = [];

async function makeUser(name: string, role: string, status = 'active'): Promise<Account> {
  const id = uuidv7();
  const phone = nextPhone();

  await pool.query(
    `INSERT INTO users (id, status, phone_e164, phone_verified_at)
          VALUES ($1, $2, $3, CASE WHEN $2 = 'guest' THEN NULL ELSE now() END)`,
    [id, status, status === 'guest' ? null : phone],
  );
  // 18+ on the profile, because every money endpoint checks it and a seeded
  // account that cannot spend is a fixture nobody can test with.
  await pool.query(
    `INSERT INTO user_profiles (user_id, display_name, country, date_of_birth, gender)
          VALUES ($1, $2, 'IN', date '1996-03-18', 'undisclosed')`,
    [id, name],
  );

  const { rows } = await pool.query('SELECT public_id FROM users WHERE id = $1', [id]);
  const account = { id, publicId: Number(rows[0].public_id), phone, name, role };
  accounts.push(account);
  return account;
}

async function makeStaff(name: string): Promise<Account> {
  const account = await makeUser(name, 'staff (ops_manager)');
  await pool.query(
    `INSERT INTO role_assignments (id, user_id, role_code, scope_type)
          VALUES ($1, $2, 'ops_manager', 'global')`,
    [uuidv7(), account.id],
  );
  return account;
}

// ── Money ───────────────────────────────────────────────────────────────────

/** Free coins, through the same path the welcome bonus and check-in use. */
async function grantCoins(user: Account, coins: number): Promise<void> {
  await postTransaction({
    txnType: 'free_coin_grant',
    idempotencyKey: `seed:grant:${user.id}`,
    identity: { seed: true, user_id: user.id },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
    },
    legs: freeCoinGrantLegs({ userId: user.id, coins }),
    memo: 'seed: starting balance',
  });
}

async function convertToGems(user: Account, coins: number): Promise<void> {
  await postTransaction({
    txnType: 'coin_to_gem_conversion',
    idempotencyKey: `seed:gems:${user.id}`,
    identity: { seed: true, user_id: user.id },
    rates: {
      faceValueUnitsPerRupee: ECONOMY.faceValueUnitsPerRupee,
      pointsPerRupee: ECONOMY.pointsPerRupee,
      coinToGemRateBp: ECONOMY.coinToGemRateBp,
    },
    legs: conversionLegs({ userId: user.id, coins }),
    memo: 'seed: gems for cosmetics',
  });
}

// ── Rooms ───────────────────────────────────────────────────────────────────

/**
 * A live room, inserted rather than opened through `goLive`.
 *
 * `goLive` mints an RTC token, and LiveKit is not configured in a fresh
 * checkout — it would refuse with RTC_UNAVAILABLE. Gifting only needs the room
 * row to say the room is live, which is what the app's feed reads too.
 */
async function openRoom(host: Account, title: string, tag: string, seats: number | null) {
  const roomId = uuidv7();
  await pool.query(
    `INSERT INTO rooms (id, host_user_id, title, tag, country, is_video,
                        seat_capacity, seats_taken, viewer_count, cover_url, started_at)
          VALUES ($1, $2, $3, $4, 'IN', true, $5, $6, $7, $8, now() - interval '25 minutes')`,
    [
      roomId,
      host.id,
      title,
      tag,
      seats,
      seats === null ? 0 : Math.max(1, Math.floor(seats * 0.5)),
      200 + Math.floor(Math.random() * 3_000),
      // Seeded on the host's name, so a room keeps the same cover across
      // re-seeds. Placeholder art under the Unsplash licence — see seed.ts.
      `https://picsum.photos/seed/dhun-${host.name.toLowerCase().replace(/\s+/g, '-')}/600/800`,
    ],
  );
  return roomId;
}

// ── The data ────────────────────────────────────────────────────────────────

interface SeededHost {
  account: Account;
  roomId: string;
}

async function main(): Promise<void> {
  console.log('seed:testers — building test accounts\n');

  // Two admins, because confirming a prepay is maker-checker: the database
  // refuses the admin who recorded it.
  const maker = await makeStaff('Ops Maker');
  const checker = await makeStaff('Ops Checker');

  const notes: string[] = [];

  /**
   * One agency, with its sub-agents and hosts.
   *
   * Built in the order the real product forces: an admin creates the agency,
   * the owner invites agents and they accept, then hosts apply to an agent and
   * that agent accepts. Consent at every step, as the rules require.
   */
  async function buildAgency(input: {
    name: string;
    ownerName: string;
    subAgents: { name: string; canManageAgents: boolean }[];
    hostNames: string[];
    isHouse?: boolean;
    coinTrading: boolean;
    prepayPaise?: number;
  }) {
    const owner = await makeUser(input.ownerName, `agency owner — ${input.name}`);
    const seat = await createAgency(maker.id, {
      ownerPublicId: owner.publicId,
      name: input.name,
      contactEmail: `${input.name.toLowerCase().replace(/\s+/g, '')}@example.com`,
      isHouse: input.isHouse,
    });

    if (input.coinTrading) {
      await setCoinTrading(maker.id, seat.agency.id, true);
    }

    // Sub-agents: invited, then they accept. Nothing exists until they do.
    const subs: Account[] = [];
    for (const sub of input.subAgents) {
      const person = await makeUser(sub.name, `sub-agent — ${input.name}`);
      const invite = await inviteAgent(owner.id, {
        invitedPublicId: person.publicId,
        canManageAgents: sub.canManageAgents,
        message: `Run a team for ${input.name}`,
      });
      await answerAgentInvite(person.id, invite.id, true);
      subs.push(person);
    }

    const roster = await listAgents(owner.id);
    const agentPublicId = (userId: string) => roster.find((a) => a.userId === userId)!.publicId;

    // Hosts, spread across the owner's own seat and each sub-agent, so the
    // commission split has something to divide.
    const holders = [owner, ...subs];
    const hosts: SeededHost[] = [];
    for (const [index, hostName] of input.hostNames.entries()) {
      const holder = holders[index % holders.length];
      const host = await makeUser(hostName, `host — ${input.name}`);
      const request = await applyToAgent(host.id, agentPublicId(holder.id), 'Let me join');
      await answerRequest(holder.id, request.id, true);
      hosts.push({
        account: host,
        roomId: await openRoom(
          host,
          ['Evening ghazals', 'Chai aur baatein', 'Antakshari night', 'Open mic'][index % 4],
          ['singing', 'chatting', 'singing', 'friends'][index % 4],
          index % 3 === 0 ? 8 : null,
        ),
      });
    }

    // Inventory, through maker-checker. Never on credit.
    if (input.coinTrading && input.prepayPaise) {
      const prepay = await recordPrepay(maker.id, {
        agencyPublicId: seat.agency.publicId,
        amountPaise: input.prepayPaise,
        method: 'bank_transfer',
        paymentReference: `UTR${randomUUID().slice(0, 12).toUpperCase()}`,
      });
      await confirmPrepay(checker.id, prepay.id);
      notes.push(
        `${input.name}: prepaid ₹${(input.prepayPaise / 100).toLocaleString('en-IN')} → ` +
          `${prepay.coins.toLocaleString('en-IN')} coins at ${prepay.coinsPerRupee}/₹`,
      );
    }

    return { owner, seat, subs, hosts };
  }

  // ── Three agencies, deliberately unalike ──────────────────────────────────

  const sur = await buildAgency({
    name: 'Sur Talent',
    ownerName: 'Sur Owner',
    subAgents: [
      { name: 'Sur Agent A', canManageAgents: true },
      { name: 'Sur Agent B', canManageAgents: false },
    ],
    hostNames: ['Riya', 'Meera', 'Sana', 'Ankit', 'Dev', 'Lisha'],
    coinTrading: true,
    prepayPaise: 20_000_000, // ₹2,00,000 — the top wholesale tier
  });

  const rhythm = await buildAgency({
    name: 'Rhythm House',
    ownerName: 'Rhythm Owner',
    subAgents: [{ name: 'Rhythm Agent', canManageAgents: false }],
    hostNames: ['Barbie', 'Sabita', 'Gemi'],
    coinTrading: true,
    prepayPaise: 1_000_000, // ₹10,000 — the floor, lowest tier
  });

  // The in-house agency: where platform-seeded hosts sit. Earns no commission,
  // and is deliberately NOT approved for coin trading.
  const house = await buildAgency({
    name: 'Dhun Official',
    ownerName: 'Dhun Staff',
    subAgents: [],
    hostNames: ['Vikram', 'Dilli Se'],
    isHouse: true,
    coinTrading: false,
  });

  // Sur Talent is an ESTABLISHED agency, past its opening window, so it runs on
  // the full transfer caps. Rhythm House stays new and keeps the reduced ones —
  // both cases are worth having in a test database, because the difference is
  // invisible until a transfer is refused.
  await pool.query("UPDATE agencies SET created_at = now() - interval '60 days' WHERE id = $1", [
    sur.seat.agency.id,
  ]);

  // An agency with hosts but NO coin trading and no sub-agents — the plain case.
  const indie = await buildAgency({
    name: 'Indie Collective',
    ownerName: 'Indie Owner',
    subAgents: [],
    hostNames: ['Zoya'],
    coinTrading: false,
  });

  const allHosts = [...sur.hosts, ...rhythm.hosts, ...house.hosts, ...indie.hosts];

  // ── Users, at every balance that behaves differently ──────────────────────

  const whale = await makeUser('Whale Vikas', 'user — whale');
  const payer = await makeUser('Payer Nisha', 'user — regular payer');
  const small = await makeUser('Small Arjun', 'user — welcome bonus only');
  const broke = await makeUser('Broke Kabir', 'user — zero balance');
  const gemsOnly = await makeUser('Gems Priya', 'user — gems, no coins');
  const banned = await makeUser('Banned Raj', 'user — BANNED');
  const guest = await makeUser('Guest Anon', 'user — guest, cannot spend', 'guest');

  // Funded the two real ways: free coins, and an agency transfer. The whale
  // buys through an agency, which is how almost every real user will.
  await grantCoins(payer, 30_000);
  await grantCoins(small, 1_000);
  await grantCoins(gemsOnly, 20_000);
  await convertToGems(gemsOnly, 20_000);

  await transfer(sur.owner.id, {
    recipientPublicId: whale.publicId,
    coins: 1_000_000,
    requestId: randomUUID(),
    note: 'Paid by UPI',
  });
  await transfer(rhythm.owner.id, {
    recipientPublicId: payer.publicId,
    coins: 50_000,
    requestId: randomUUID(),
    note: 'Paytm received',
  });

  await pool.query("UPDATE users SET status = 'banned' WHERE id = $1", [banned.id]);
  void broke;
  void guest;

  // ── Gifts: several senders, several hosts, several tiers ──────────────────

  const gifts: { id: string; price: number }[] = [
    { id: 'heart', price: 20 },
    { id: 'rose', price: 90 },
    { id: 'laddu', price: 330 },
    { id: 'perfume', price: 999 },
    { id: 'scooter', price: 6_600 },
  ];

  async function gift(
    sender: Account,
    host: SeededHost,
    giftIndex: number,
    quantity: GiftQuantity,
  ) {
    const chosen = gifts[giftIndex % gifts.length];
    await sendGift({
      senderId: sender.id,
      roomId: host.roomId,
      recipientId: host.account.id,
      giftId: chosen.id,
      quantity,
      expectedCoinPrice: chosen.price,
      idempotencyKey: randomUUID(),
    });
  }

  // The whale spreads across six hosts in two agencies, at the top of the
  // ladder — so leaderboards, host earnings and agency volume all have shape.
  for (const [index, host] of allHosts.slice(0, 6).entries()) {
    await gift(whale, host, 4 - (index % 3), index % 2 === 0 ? 10 : 99);
  }
  // A regular payer gives smaller amounts to three hosts.
  for (const [index, host] of allHosts.slice(0, 3).entries()) {
    await gift(payer, host, index, 10);
  }
  // And one small user gives one rose, which is the commonest event of all.
  await gift(small, allHosts[0], 1, 1);

  // ── A closed period, so commission is not an empty screen ─────────────────
  //
  // The links and the gifts are pushed back into last month and the period is
  // closed, which is what the nightly job will do on the 1st. Without this the
  // commission card is correct but blank, and a blank screen demonstrates
  // nothing.
  const lastMonth = previousMonth(istMonth());
  await pool.query(
    "UPDATE host_agent_assignments SET effective_from = now() - interval '4 months' WHERE effective_to IS NULL",
  );
  await pool.query(
    "UPDATE agent_agency_assignments SET effective_from = now() - interval '4 months' WHERE effective_to IS NULL",
  );
  // Half the gifts move into last month; the rest stay in this one, so both
  // "paid" and "earning towards next month" have numbers.
  //
  // `gift_sends` is append-only by trigger — a real gift's record can never be
  // edited, which is the invariant that keeps the leaderboard and the ledger in
  // step. Backdating is the one thing a seed needs that production must never
  // do, so the guard comes off for exactly these two statements and goes
  // straight back on.
  await pool.query('ALTER TABLE gift_sends DISABLE TRIGGER trg_gift_sends_immutable');
  try {
    await pool.query(
      `WITH half AS (
         SELECT txn_id FROM gift_sends ORDER BY created_at LIMIT (SELECT count(*) / 2 FROM gift_sends)
       )
       UPDATE gift_sends SET created_at = date_trunc('month', now()) - interval '10 days'
        WHERE txn_id IN (SELECT txn_id FROM half)`,
    );
  } finally {
    await pool.query('ALTER TABLE gift_sends ENABLE TRIGGER trg_gift_sends_immutable');
  }
  await pool.query(
    `UPDATE ledger_txns SET created_at = date_trunc('month', now()) - interval '10 days'
      WHERE id IN (SELECT txn_id FROM gift_sends
                    WHERE created_at < date_trunc('month', now()))`,
  );
  await openPeriod(lastMonth);
  const closed = await closePeriod(lastMonth, maker.id);
  notes.push(
    `commission: closed ${lastMonth} — ${closed.accruals.length} payees, ` +
      `${closed.giftPoints.toLocaleString('en-IN')} team points`,
  );

  // ── Everything that makes a screen look alive ────────────────────────────
  //
  // A correct app with empty lists demonstrates nothing. Follows fill the
  // Following tab, chat fills the rooms, visitors fill the Me tab, worn
  // cosmetics put frames on avatars in every list they appear in.

  const viewers = [whale, payer, small, broke, gemsOnly];

  // Follows, both ways: every viewer follows several hosts, and a few hosts
  // follow back — which is what makes someone a "friend" rather than a follower.
  for (const viewer of viewers) {
    for (const host of allHosts.slice(0, 6)) {
      await pool.query(
        `INSERT INTO follows (follower_user_id, followee_user_id)
              VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [viewer.id, host.account.id],
      );
    }
  }
  for (const host of allHosts.slice(0, 3)) {
    await pool.query(
      `INSERT INTO follows (follower_user_id, followee_user_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [host.account.id, whale.id],
    );
  }

  // Room chat. One blocked line per room on purpose: the moderation verdict is
  // stored beside what was actually typed, and a reviewer needs to see both.
  const CHAT = [
    'namaste everyone 🙏',
    'aaj ka song request — kabhi kabhi',
    'voice clear aa rahi hai',
    'bohot sundar 👏',
    'kahan se ho aap?',
    'ek aur gaana please',
  ];
  for (const host of allHosts) {
    for (const [index, body] of CHAT.entries()) {
      const speaker = viewers[index % viewers.length];
      await pool.query(
        `INSERT INTO room_messages (id, room_id, user_id, body, verdict, created_at)
              VALUES ($1, $2, $3, $4, 'clean', now() - make_interval(mins => $5))`,
        [uuidv7(), host.roomId, speaker.id, body, CHAT.length - index],
      );
    }
    await pool.query(
      `INSERT INTO room_messages (id, room_id, user_id, body, verdict, created_at)
            VALUES ($1, $2, $3, 'my number is 98XXXXXX, whatsapp me', 'blocked', now() - interval '2 minutes')`,
      [uuidv7(), host.roomId, viewers[1].id],
    );
  }

  // Profile visitors, unseen, so the Me tab shows a count worth tapping.
  for (const host of allHosts.slice(0, 4)) {
    await pool.query(
      `INSERT INTO profile_visits (profile_user_id, viewer_user_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [whale.id, host.account.id],
    );
  }
  for (const viewer of viewers.slice(0, 3)) {
    await pool.query(
      `INSERT INTO profile_visits (profile_user_id, viewer_user_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [allHosts[0].account.id, viewer.id],
    );
  }

  // Cosmetics, worn. A frame and a nickname colour ride on seats, chat lines,
  // gift senders and profiles, so one purchase shows up on six screens.
  const WORN: [Account, string, string][] = [
    [whale, 'frame_basic', 'frame'],
    [whale, 'nickname_color', 'nickname_color'],
    [whale, 'entry_premium', 'entry_effect'],
    [payer, 'chat_bubble', 'chat_bubble'],
    [gemsOnly, 'frame_basic', 'frame'],
    [allHosts[0].account, 'frame_basic', 'frame'],
    [allHosts[1].account, 'nickname_color', 'nickname_color'],
  ];
  for (const [owner, cosmeticId, kind] of WORN) {
    await pool.query(
      `INSERT INTO user_cosmetics (user_id, cosmetic_id, kind, expires_at, equipped)
            VALUES ($1, $2, $3, now() + interval '30 days', true)
       ON CONFLICT (user_id, cosmetic_id) DO NOTHING`,
      [owner.id, cosmeticId, kind],
    );
  }
  // One lapsed item, so the expiry path is visible rather than theoretical.
  await pool.query(
    `INSERT INTO user_cosmetics (user_id, cosmetic_id, kind, expires_at, equipped)
          VALUES ($1, 'entry_basic', 'entry_effect', now() - interval '2 days', true)
     ON CONFLICT (user_id, cosmetic_id) DO NOTHING`,
    [payer.id],
  );

  // ── Message threads ───────────────────────────────────────────────────────
  //
  // Unread on purpose: the badge, the filter chips and the unread dot cannot be
  // checked against a thread that has already been read.

  /** A platform thread: one voice, no sender, `accent` tints the avatar. */
  async function officialThread(
    owner: Account,
    title: string,
    accent: 'money' | 'security' | 'system',
    bodies: string[],
    minutesAgo = 90,
  ) {
    const threadId = uuidv7();
    await pool.query(
      'INSERT INTO message_threads (id, kind, title, accent) VALUES ($1, $2, $3, $4)',
      [threadId, 'official', title, accent],
    );
    await pool.query(
      'INSERT INTO thread_participants (thread_id, user_id, last_read_at) VALUES ($1, $2, NULL)',
      [threadId, owner.id],
    );
    for (const [index, body] of bodies.entries()) {
      await pool.query(
        `INSERT INTO messages (id, thread_id, sender_user_id, body, created_at)
         VALUES ($1, $2, NULL, $3, now() - make_interval(mins => $4))`,
        [uuidv7(), threadId, body, minutesAgo - index * 5],
      );
    }
  }

  /**
   * A conversation between two people.
   *
   * A direct thread stores no title — it is named for whoever you are talking
   * to — so BOTH participants must exist or the list has nothing to call it.
   * The owner's side is left UNREAD so their inbox shows a badge.
   */
  async function directThread(
    other: Account,
    owner: Account,
    lines: { from: Account; body: string }[],
    minutesAgo = 240,
  ) {
    const threadId = uuidv7();
    await pool.query(
      "INSERT INTO message_threads (id, kind, title, accent) VALUES ($1, 'direct', NULL, NULL)",
      [threadId],
    );
    await pool.query(
      `INSERT INTO thread_participants (thread_id, user_id, last_read_at)
       VALUES ($1, $2, now()), ($1, $3, NULL)`,
      [threadId, other.id, owner.id],
    );
    for (const [index, line] of lines.entries()) {
      await pool.query(
        `INSERT INTO messages (id, thread_id, sender_user_id, body, created_at)
         VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5))`,
        [uuidv7(), threadId, line.from.id, line.body, minutesAgo - index * 7],
      );
    }
  }

  for (const viewer of [whale, payer]) {
    await officialThread(viewer, 'Income Reminder', 'money', [
      'Your daily check-in is ready. Open Rewards to collect your coins.',
    ]);
  }

  // The agency owner's inbox: what someone running Sur Talent would actually
  // have waiting — the platform telling them about money and access, and their
  // own people asking for things.
  await officialThread(
    sur.owner,
    'Commission',
    'money',
    [
      'September commission has been credited: 17,265 points.',
      'Your October rate is level D, 4% of your team’s earnings. It is fixed for the month.',
    ],
    35,
  );
  await officialThread(
    sur.owner,
    'Agency Centre',
    'system',
    [
      'Coin trading has been enabled for Sur Talent.',
      'Your prepay of ₹2,00,000 was confirmed. 2,80,00,000 coins are in your stock.',
    ],
    120,
  );
  await officialThread(
    sur.owner,
    'Account Security Centre',
    'security',
    ['Your account was signed in on a new device. If this was not you, secure your account.'],
    400,
  );

  await directThread(sur.hosts[0].account, sur.owner, [
    { from: sur.hosts[0].account, body: 'Sir, kal main 8 baje live aaungi' },
    { from: sur.owner, body: 'Theek hai, peak hours hain — zaroor aana' },
    { from: sur.hosts[0].account, body: 'Ji, pakka' },
  ]);
  await directThread(sur.subs[0], sur.owner, [
    { from: sur.subs[0], body: 'Do naye hosts aaye hain is hafte' },
    { from: sur.owner, body: 'Badhiya. Unka target set kar dena' },
  ]);
  await directThread(sur.hosts[1].account, sur.owner, [
    {
      from: sur.hosts[1].account,
      body: 'Sir maine agency chhodne ki request daali hai, family reason hai',
    },
  ]);

  // Reports and a block, so moderation has a queue rather than an empty table.
  const REPORTS: [string, string][] = [
    ['harassment', 'Kept asking for my number after I said no'],
    ['spam', 'Posting the same link every minute'],
    ['scam', 'Asked me to pay outside the app for coins'],
  ];
  for (const [index, [reason, detail]] of REPORTS.entries()) {
    await pool.query(
      `INSERT INTO reports (id, reporter_user_id, subject_type, subject_id, reason, detail)
            VALUES ($1, $2, 'user', $3, $4, $5)`,
      [uuidv7(), viewers[index].id, allHosts[index + 2].account.id, reason, detail],
    );
  }
  await pool.query(
    `INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [payer.id, banned.id],
  );

  // ── Things waiting for someone to decide ──────────────────────────────────

  // A host who has applied to leave: sits in the owner's queue.
  const quitter = sur.hosts[1];
  await pool.query('UPDATE users SET face_auth_attempted_at = now() WHERE id = $1', [
    quitter.account.id,
  ]);
  await applyToQuit(quitter.account.id, 'Moving to another city');
  notes.push(`pending quit: ${quitter.account.name} is waiting on ${sur.owner.name}`);

  // A host who has applied to JOIN: sits in the agent's queue.
  const applicant = await makeUser('Applicant Tara', 'host — application pending');
  const surRoster = await listAgents(sur.owner.id);
  await applyToAgent(
    applicant.id,
    surRoster.find((a) => a.isOwner)!.publicId,
    'I sing every evening',
  );
  notes.push(`pending join: ${applicant.name} applied to Sur Talent`);

  // An agent invitation nobody has answered yet.
  const invitee = await makeUser('Invitee Nikhil', 'agent — invitation pending');
  await inviteAgent(rhythm.owner.id, {
    invitedPublicId: invitee.publicId,
    canManageAgents: false,
    message: 'Come run a team',
  });
  notes.push(`pending agent invite: ${invitee.name} from Rhythm House`);

  // ── Report ────────────────────────────────────────────────────────────────

  const width = Math.max(...accounts.map((a) => a.name.length));
  console.log('  PHONE            USER ID    NAME'.padEnd(width + 30) + 'ROLE');
  console.log('  ' + '-'.repeat(width + 58));
  for (const a of accounts) {
    console.log(`  ${a.phone}   ${a.publicId}   ${a.name.padEnd(width)}  ${a.role}`);
  }

  console.log('\n  Notes');
  for (const note of notes) console.log(`  · ${note}`);

  const counts = await pool.query<{ what: string; n: string }>(
    `SELECT 'live rooms' AS what, count(*)::text AS n FROM rooms WHERE ended_at IS NULL
     UNION ALL SELECT 'gifts sent', count(*)::text FROM gift_sends
     UNION ALL SELECT 'room chat lines', count(*)::text FROM room_messages
     UNION ALL SELECT 'follows', count(*)::text FROM follows
     UNION ALL SELECT 'cosmetics worn', count(*)::text FROM user_cosmetics WHERE equipped
     UNION ALL SELECT 'open reports', count(*)::text FROM reports WHERE status = 'open'
     UNION ALL SELECT 'agency transfers', count(*)::text FROM agency_transfers
     UNION ALL SELECT 'commission accruals', count(*)::text FROM commission_accruals`,
  );
  console.log('\n  Data');
  for (const row of counts.rows) console.log(`  · ${row.n} ${row.what}`);

  console.log(
    '\n  Sign in with any phone above. The dev OTP provider returns the code in\n' +
      '  the response, and the app prints it on the OTP screen.\n',
  );
}

/**
 * Sending a gift publishes to the room bus, which opens a Redis client — and
 * with no Redis running it sits in a reconnect loop that keeps the event loop
 * alive forever. Closing it is what lets this script exit.
 */
async function shutdown(): Promise<void> {
  await closeRoomBus().catch(() => undefined);
  await pool.end().catch(() => undefined);
}

main()
  .then(shutdown)
  .catch(async (err) => {
    console.error('\nseed:testers failed:', err instanceof Error ? err.message : err);
    await shutdown();
    process.exit(1);
  });
