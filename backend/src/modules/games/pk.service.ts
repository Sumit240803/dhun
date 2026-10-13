// PK battles: a scoreboard over gifts that have already been paid.
//
// ── Read migration 028's header first. The short version ────────────────────
//
// Nothing in this file moves money. Every gift counted here was settled by
// `gifting`, through the ledger, at the moment it was sent. PK reads those
// rows and adds them up.
//
// That is a legal boundary. Pooling the two audiences' gifts, or returning the
// losing side's, turns a purchase into a wager on an uncertain outcome — an
// online money game under the Act, which is hard rule #1. So this module never
// calls `economy`, and the one number that looks like it might (the streak
// multiplier) is display-only and lives in `pk.config.ts` with the same warning.
//
// ── Scores are derived ──────────────────────────────────────────────────────
//
// `score()` SUMs `gift_sends` inside the window. There is no counter to drift,
// no cache to invalidate, and a gift reversed by moderation simply stops
// counting. The same reasoning as ledger balances and commission attributions.
//
// The settled result IS stored, because who won is a historical fact rather
// than a running figure.

import type { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { enqueueEvent } from '../../infra/outbox.js';
import { publishToRoom } from '../../infra/roomBus.js';
import { pkConfig, streakMultiplier, type PkConfig } from './pk.config.js';

export interface PkSideView {
  userId: string;
  roomId: string;
  displayName: string | null;
  avatarUrl: string | null;
  score: number;
  streak: number;
  /** Display only. See `pk.config.ts`. */
  winMultiplier: number;
  supporters: PkSupporterView[];
}

export interface PkSupporterView {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  coins: number;
}

export interface PkBattleView {
  id: string;
  mode: '1v1' | 'team';
  /** `warmup` while pending, `live` while running, `result` once settled. */
  phase: 'warmup' | 'live' | 'result';
  home: 0;
  sides: [PkSideView, PkSideView];
  endsAt: string;
  /** Index of the winner, or null for a draw or a battle still running. */
  winner: 0 | 1 | null;
}

interface BattleRow {
  id: string;
  mode: '1v1' | 'team';
  state: 'pending' | 'live' | 'ended' | 'cancelled';
  home_room_id: string;
  away_room_id: string;
  home_user_id: string;
  away_user_id: string;
  started_at: Date | null;
  ends_at: Date | null;
  settled_at: Date | null;
  winner_user_id: string | null;
  home_score: string | number;
  away_score: string | number;
}

/** How many faces fit under a tile in the app. */
const SUPPORTERS_SHOWN = 4;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const BATTLE_SELECT = `
  SELECT id, mode, state, home_room_id, away_room_id, home_user_id, away_user_id,
         started_at, ends_at, settled_at, winner_user_id, home_score, away_score
    FROM pk_battles`;

/** The battle a room is in right now, or null. */
export async function battleForRoom(roomId: string): Promise<PkBattleView | null> {
  const { rows } = await pool.query<BattleRow>(
    `${BATTLE_SELECT}
      WHERE (home_room_id = $1 OR away_room_id = $1)
        AND state IN ('pending', 'live')
      ORDER BY created_at DESC
      LIMIT 1`,
    [roomId],
  );
  const row = rows[0];
  return row ? await toView(row) : null;
}

/**
 * The two scores, SUMMED from gift_sends inside the window.
 *
 * One query for both sides. Served by `gift_sends_recipient_idx` on
 * (recipient_user_id, created_at DESC), which migration 015 already created
 * for the host's own gift history — this query is the same shape.
 *
 * A battle that has not started yet scores 0 for both: `started_at` is null,
 * and counting the gifts a host received before the bar appeared would hand
 * one side a head start nobody could see being earned.
 */
export async function scores(
  battle: Pick<BattleRow, 'home_user_id' | 'away_user_id' | 'started_at' | 'ends_at'>,
  client: PoolClient | typeof pool = pool,
): Promise<{ home: number; away: number }> {
  if (battle.started_at === null || battle.ends_at === null) return { home: 0, away: 0 };

  const { rows } = await client.query<{ recipient_user_id: string; coins: string }>(
    `SELECT recipient_user_id, COALESCE(SUM(coins), 0) AS coins
       FROM gift_sends
      WHERE recipient_user_id = ANY($1::uuid[])
        AND created_at >= $2
        AND created_at < $3
      GROUP BY recipient_user_id`,
    [[battle.home_user_id, battle.away_user_id], battle.started_at, battle.ends_at],
  );

  const byUser = new Map(rows.map((row) => [row.recipient_user_id, Number(row.coins)]));
  return {
    home: byUser.get(battle.home_user_id) ?? 0,
    away: byUser.get(battle.away_user_id) ?? 0,
  };
}

/** Who gave the most to each side, best first. */
async function supporters(
  battle: Pick<BattleRow, 'home_user_id' | 'away_user_id' | 'started_at' | 'ends_at'>,
): Promise<Map<string, PkSupporterView[]>> {
  const empty = new Map<string, PkSupporterView[]>();
  if (battle.started_at === null || battle.ends_at === null) return empty;

  const { rows } = await pool.query<{
    recipient_user_id: string;
    sender_user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    coins: string;
  }>(
    `SELECT g.recipient_user_id, g.sender_user_id, p.display_name, p.avatar_url,
            SUM(g.coins) AS coins
       FROM gift_sends g
       LEFT JOIN user_profiles p ON p.user_id = g.sender_user_id
      WHERE g.recipient_user_id = ANY($1::uuid[])
        AND g.created_at >= $2
        AND g.created_at < $3
      GROUP BY g.recipient_user_id, g.sender_user_id, p.display_name, p.avatar_url
      ORDER BY g.recipient_user_id, coins DESC`,
    [[battle.home_user_id, battle.away_user_id], battle.started_at, battle.ends_at],
  );

  for (const row of rows) {
    const list = empty.get(row.recipient_user_id) ?? [];
    if (list.length < SUPPORTERS_SHOWN) {
      list.push({
        userId: row.sender_user_id,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        coins: Number(row.coins),
      });
    }
    empty.set(row.recipient_user_id, list);
  }
  return empty;
}

async function toView(row: BattleRow): Promise<PkBattleView> {
  const config = await pkConfig();
  const settled = row.state === 'ended' || row.state === 'cancelled';

  // A settled battle shows its FROZEN scores, not a fresh sum. The result must
  // survive a gift being reversed afterwards, or last week's winner changes.
  const live = settled
    ? { home: Number(row.home_score), away: Number(row.away_score) }
    : await scores(row);

  const [profiles, byUser, stats] = await Promise.all([
    profilesFor([row.home_user_id, row.away_user_id]),
    settled ? new Map<string, PkSupporterView[]>() : supporters(row),
    statsFor([row.home_user_id, row.away_user_id]),
  ]);

  const side = (userId: string, roomId: string, score: number): PkSideView => {
    const streak = stats.get(userId) ?? 0;
    return {
      userId,
      roomId,
      displayName: profiles.get(userId)?.displayName ?? null,
      avatarUrl: profiles.get(userId)?.avatarUrl ?? null,
      score,
      streak,
      winMultiplier: streakMultiplier(streak, config),
      supporters: byUser.get(userId) ?? [],
    };
  };

  return {
    id: row.id,
    mode: row.mode,
    phase: row.state === 'pending' ? 'warmup' : row.state === 'live' ? 'live' : 'result',
    home: 0,
    sides: [
      side(row.home_user_id, row.home_room_id, live.home),
      side(row.away_user_id, row.away_room_id, live.away),
    ],
    endsAt: (row.ends_at ?? row.settled_at ?? new Date()).toISOString(),
    winner:
      row.winner_user_id === null
        ? null
        : row.winner_user_id === row.home_user_id
          ? 0
          : 1,
  };
}

async function profilesFor(
  userIds: string[],
): Promise<Map<string, { displayName: string | null; avatarUrl: string | null }>> {
  const { rows } = await pool.query<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
  }>(
    'SELECT user_id, display_name, avatar_url FROM user_profiles WHERE user_id = ANY($1::uuid[])',
    [userIds],
  );
  return new Map(
    rows.map((row) => [row.user_id, { displayName: row.display_name, avatarUrl: row.avatar_url }]),
  );
}

async function statsFor(userIds: string[]): Promise<Map<string, number>> {
  const { rows } = await pool.query<{ user_id: string; streak: number }>(
    'SELECT user_id, streak FROM pk_host_stats WHERE user_id = ANY($1::uuid[])',
    [userIds],
  );
  return new Map(rows.map((row) => [row.user_id, row.streak]));
}

// ---------------------------------------------------------------------------
// Starting a battle
// ---------------------------------------------------------------------------

/**
 * The room a user is hosting right now.
 *
 * Every PK action requires one: you cannot challenge anybody from the sofa.
 * Returning the room rather than a boolean means the caller never has to ask
 * twice, and the battle rows need the id anyway.
 */
async function liveRoomOf(userId: string, client: PoolClient | typeof pool = pool): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM rooms WHERE host_user_id = $1 AND ended_at IS NULL',
    [userId],
  );
  const roomId = rows[0]?.id;
  if (!roomId) throw new AppError('NOT_LIVE', 'Go live before starting a battle', 409);
  return roomId;
}

async function requireEnabled(): Promise<PkConfig> {
  const config = await pkConfig();
  if (!config.enabled) {
    throw new AppError('PK_UNAVAILABLE', 'Battles are not available right now', 503);
  }
  return config;
}

/** Invite another host to a battle. */
export async function invite(input: {
  fromUserId: string;
  toUserId: string;
}): Promise<{ inviteId: string; expiresAt: string }> {
  const config = await requireEnabled();
  if (input.fromUserId === input.toUserId) {
    throw new AppError('PK_SELF', 'You cannot battle yourself', 422);
  }

  const fromRoom = await liveRoomOf(input.fromUserId);
  // The other host must be live too. An invitation to somebody who is not
  // broadcasting can never be accepted, and telling the sender now is kinder
  // than a minute of silence.
  await liveRoomOf(input.toUserId);
  await assertFree(input.fromUserId);
  await assertFree(input.toUserId);

  const id = uuidv7();
  const expiresAt = new Date(Date.now() + config.inviteTtlSeconds * 1_000);

  try {
    await pool.query(
      `INSERT INTO pk_invites (id, from_user_id, from_room_id, to_user_id, expires_at)
            VALUES ($1, $2, $3, $4, $5)`,
      [id, input.fromUserId, fromRoom, input.toUserId, expiresAt],
    );
  } catch (error) {
    // The partial unique index on (from, to) WHERE pending. Re-inviting while
    // one is outstanding is a double tap, not an error worth a stack trace.
    if ((error as { code?: string }).code === '23505') {
      throw new AppError('PK_INVITE_PENDING', 'You have already invited them', 409);
    }
    throw error;
  }

  return { inviteId: id, expiresAt: expiresAt.toISOString() };
}

/** Everything waiting for this host's answer. */
export async function inbox(userId: string): Promise<
  { id: string; fromUserId: string; displayName: string | null; expiresAt: string }[]
> {
  const { rows } = await pool.query<{
    id: string;
    from_user_id: string;
    display_name: string | null;
    expires_at: Date;
  }>(
    `SELECT i.id, i.from_user_id, p.display_name, i.expires_at
       FROM pk_invites i
       LEFT JOIN user_profiles p ON p.user_id = i.from_user_id
      WHERE i.to_user_id = $1 AND i.state = 'pending' AND i.expires_at > now()
      ORDER BY i.created_at DESC
      LIMIT 20`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    fromUserId: row.from_user_id,
    displayName: row.display_name,
    expiresAt: row.expires_at.toISOString(),
  }));
}

/** Accept, and go live with it. */
export async function acceptInvite(input: {
  inviteId: string;
  userId: string;
  durationSeconds?: number;
}): Promise<PkBattleView> {
  const config = await requireEnabled();
  const duration = clampDuration(input.durationSeconds ?? config.durationSeconds, config);

  const battleId = await withTransaction(async (client) => {
    // Locked, so two taps on Accept cannot both pass the state check.
    const { rows } = await client.query<{
      id: string;
      from_user_id: string;
      from_room_id: string;
      state: string;
      expires_at: Date;
    }>(
      `SELECT id, from_user_id, from_room_id, state, expires_at
         FROM pk_invites
        WHERE id = $1 AND to_user_id = $2
        FOR UPDATE`,
      [input.inviteId, input.userId],
    );
    const invitation = rows[0];
    if (!invitation) throw new AppError('PK_INVITE_NOT_FOUND', 'That invitation is gone', 404);
    if (invitation.state !== 'pending') {
      throw new AppError('PK_INVITE_ANSWERED', 'That invitation was already answered', 409);
    }
    if (invitation.expires_at.getTime() <= Date.now()) {
      await client.query("UPDATE pk_invites SET state = 'expired' WHERE id = $1", [invitation.id]);
      throw new AppError('PK_INVITE_EXPIRED', 'That invitation has expired', 409);
    }

    const toRoom = await liveRoomOf(input.userId, client);
    // Re-checked inside the transaction. The inviter may have started a
    // different battle in the seconds since they sent this.
    const inviterRoom = await liveRoomOf(invitation.from_user_id, client);

    await client.query("UPDATE pk_invites SET state = 'accepted', responded_at = now() WHERE id = $1", [
      invitation.id,
    ]);
    // Every other invitation either host is holding is now moot.
    await client.query(
      `UPDATE pk_invites SET state = 'expired', responded_at = now()
        WHERE state = 'pending'
          AND (from_user_id = ANY($1::uuid[]) OR to_user_id = ANY($1::uuid[]))`,
      [[invitation.from_user_id, input.userId]],
    );

    return startBattle(client, {
      mode: '1v1',
      homeUserId: invitation.from_user_id,
      homeRoomId: inviterRoom,
      awayUserId: input.userId,
      awayRoomId: toRoom,
      durationSeconds: duration,
    });
  });

  const view = await byId(battleId);
  announce(view, 'pk:started');
  return view;
}

export async function declineInvite(inviteId: string, userId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE pk_invites SET state = 'declined', responded_at = now()
      WHERE id = $1 AND to_user_id = $2 AND state = 'pending'`,
    [inviteId, userId],
  );
  if (rowCount === 0) throw new AppError('PK_INVITE_NOT_FOUND', 'That invitation is gone', 404);
}

/**
 * Join the random queue — the "Random PK" the references advertise.
 *
 * Matching happens in the worker rather than here. Pairing inside the request
 * would mean the second host to arrive does the work and the first one's
 * request has already returned, so one of two matched hosts would learn about
 * their battle from a push and the other from a response. One path for both is
 * simpler to reason about and to test.
 */
export async function joinQueue(userId: string): Promise<{ position: number }> {
  await requireEnabled();
  const roomId = await liveRoomOf(userId);
  await assertFree(userId);

  await pool.query(
    `INSERT INTO pk_queue (user_id, room_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET room_id = EXCLUDED.room_id`,
    [userId, roomId],
  );

  const { rows } = await pool.query<{ position: string }>(
    `SELECT count(*) AS position FROM pk_queue
      WHERE joined_at <= (SELECT joined_at FROM pk_queue WHERE user_id = $1)`,
    [userId],
  );
  return { position: Number(rows[0]?.position ?? 1) };
}

export async function leaveQueue(userId: string): Promise<void> {
  await pool.query('DELETE FROM pk_queue WHERE user_id = $1', [userId]);
}

/**
 * Writes the battle row. Caller holds the transaction.
 *
 * The unique indexes `pk_one_live_per_home` / `_away` are what actually stop a
 * host being in two battles — not the `assertFree` checks above, which are
 * there to produce a sentence rather than a constraint violation. Two
 * invitations accepted in the same millisecond both pass the check and one of
 * them hits the index.
 */
async function startBattle(
  client: PoolClient,
  input: {
    mode: '1v1' | 'team';
    homeUserId: string;
    homeRoomId: string;
    awayUserId: string;
    awayRoomId: string;
    durationSeconds: number;
  },
): Promise<string> {
  const id = uuidv7();
  try {
    await client.query(
      `INSERT INTO pk_battles (id, mode, state, home_room_id, away_room_id,
                               home_user_id, away_user_id, started_at, ends_at)
            VALUES ($1, $2, 'live', $3, $4, $5, $6, now(), now() + make_interval(secs => $7))`,
      [
        id,
        input.mode,
        input.homeRoomId,
        input.awayRoomId,
        input.homeUserId,
        input.awayUserId,
        input.durationSeconds,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new AppError('PK_ALREADY_IN_BATTLE', 'One of you is already in a battle', 409);
    }
    throw error;
  }

  // Both hosts leave the queue: a matched host must not be matched again.
  await client.query('DELETE FROM pk_queue WHERE user_id = ANY($1::uuid[])', [
    [input.homeUserId, input.awayUserId],
  ]);

  await enqueueEvent(client, {
    eventType: 'pk_started',
    partitionKey: id,
    payload: {
      battle_id: id,
      mode: input.mode,
      home_user_id: input.homeUserId,
      away_user_id: input.awayUserId,
      duration_seconds: input.durationSeconds,
    },
  });

  return id;
}

async function assertFree(userId: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM pk_battles
      WHERE (home_user_id = $1 OR away_user_id = $1) AND state IN ('pending', 'live')
      LIMIT 1`,
    [userId],
  );
  if (rows[0]) throw new AppError('PK_ALREADY_IN_BATTLE', 'Already in a battle', 409);
}

function clampDuration(seconds: number, config: PkConfig): number {
  return Math.min(config.maxDurationSeconds, Math.max(config.minDurationSeconds, seconds));
}

export async function byId(battleId: string): Promise<PkBattleView> {
  const { rows } = await pool.query<BattleRow>(`${BATTLE_SELECT} WHERE id = $1`, [battleId]);
  const row = rows[0];
  if (!row) throw new AppError('PK_NOT_FOUND', 'That battle does not exist', 404);
  return await toView(row);
}

// ---------------------------------------------------------------------------
// Ending a battle
// ---------------------------------------------------------------------------

/**
 * Settles one battle: freeze the scores, name a winner, update both streaks.
 *
 * Idempotent by the `state = 'live'` guard in the UPDATE — a second call
 * matches no rows and returns null. The sweep, a host leaving and an admin can
 * all reach this at once.
 *
 * No money moves. The winner receives a streak badge; both audiences keep the
 * gifts they sent, which were paid to their host when they were sent.
 */
export async function settle(
  battleId: string,
  reason: string | null = null,
): Promise<PkBattleView | null> {
  const settled = await withTransaction(async (client) => {
    const { rows } = await client.query<BattleRow>(
      `${BATTLE_SELECT} WHERE id = $1 AND state = 'live' FOR UPDATE`,
      [battleId],
    );
    const row = rows[0];
    if (!row) return null;

    // Recomputed from gift_sends, not read from any counter — this sum is the
    // authoritative result and it is the last time it is ever computed.
    const final = await scores(row, client);
    const winner =
      final.home === final.away ? null : final.home > final.away ? row.home_user_id : row.away_user_id;

    await client.query(
      `UPDATE pk_battles
          SET state = $2, settled_at = now(), winner_user_id = $3,
              home_score = $4, away_score = $5, cancelled_reason = $6
        WHERE id = $1`,
      [
        battleId,
        reason === null ? 'ended' : 'cancelled',
        winner,
        final.home,
        final.away,
        reason,
      ],
    );

    await bumpStats(client, row.home_user_id, outcome(row.home_user_id, winner));
    await bumpStats(client, row.away_user_id, outcome(row.away_user_id, winner));

    await enqueueEvent(client, {
      eventType: 'pk_ended',
      partitionKey: battleId,
      payload: {
        battle_id: battleId,
        home_user_id: row.home_user_id,
        away_user_id: row.away_user_id,
        home_score: final.home,
        away_score: final.away,
        winner_user_id: winner,
        reason,
      },
    });

    return row.id;
  });

  if (settled === null) return null;

  const view = await byId(settled);
  announce(view, 'pk:ended');
  logger.info('pk settled', {
    battle_id: settled,
    home_score: view.sides[0].score,
    away_score: view.sides[1].score,
    winner: view.winner,
    reason,
  });
  return view;
}

/**
 * What this battle was for one of its two hosts.
 *
 * A null winner is a DRAW for both sides — including the common 0-0 case where
 * neither host was gifted anything. Reading "no winner" as a loss for both
 * would reset two streaks for a battle nobody lost.
 */
function outcome(userId: string, winner: string | null): 'win' | 'loss' | 'draw' {
  if (winner === null) return 'draw';
  return winner === userId ? 'win' : 'loss';
}

async function bumpStats(
  client: PoolClient,
  userId: string,
  result: 'win' | 'loss' | 'draw',
): Promise<void> {
  await client.query(
    `INSERT INTO pk_host_stats (user_id, streak, best_streak, wins, losses, draws)
          VALUES ($1, $2, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       -- A loss or a draw resets the run. Only consecutive wins count, which
       -- is the whole point of a streak.
       streak      = CASE WHEN $2 = 0 THEN 0 ELSE pk_host_stats.streak + 1 END,
       best_streak = GREATEST(
                       pk_host_stats.best_streak,
                       CASE WHEN $2 = 0 THEN 0 ELSE pk_host_stats.streak + 1 END
                     ),
       wins        = pk_host_stats.wins + $3,
       losses      = pk_host_stats.losses + $4,
       draws       = pk_host_stats.draws + $5`,
    [
      userId,
      result === 'win' ? 1 : 0,
      result === 'win' ? 1 : 0,
      result === 'loss' ? 1 : 0,
      result === 'draw' ? 1 : 0,
    ],
  );
}

/**
 * A host's room ended, so their battle ends with it.
 *
 * Called by `rooms` when a broadcast closes. The battle is settled on the
 * scores as they stand rather than voided: the other host's audience spent real
 * money on a bar that was real while it was moving, and erasing it because
 * somebody's connection dropped is how you lose both audiences at once.
 */
export async function endBattlesForRoom(roomId: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM pk_battles
      WHERE (home_room_id = $1 OR away_room_id = $1) AND state IN ('pending', 'live')`,
    [roomId],
  );
  for (const row of rows) await settle(row.id, 'room_ended');
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

/**
 * Push the battle to BOTH rooms.
 *
 * Both, always, and that is the point of a PK: each audience has to see the
 * other side's number move or there is nothing to respond to.
 */
export function announce(view: PkBattleView, type: 'pk:started' | 'pk:score' | 'pk:ended'): void {
  for (const side of view.sides) {
    publishToRoom(side.roomId, { t: type, roomId: side.roomId, pk: view });
  }
}

/**
 * A gift landed; re-push the scores if it was inside a battle.
 *
 * Driven from the outbox consumer rather than from the gift request, because
 * rule 3 of the monolith is that side effects go through the event bus. The
 * gift itself must not wait on, or fail because of, a scoreboard.
 *
 * Returns the battle it touched, for the worker's log.
 */
export async function onGiftToHost(recipientUserId: string): Promise<string | null> {
  const { rows } = await pool.query<BattleRow>(
    `${BATTLE_SELECT}
      WHERE (home_user_id = $1 OR away_user_id = $1)
        AND state = 'live'
      LIMIT 1`,
    [recipientUserId],
  );
  const row = rows[0];
  if (!row) return null;

  announce(await toView(row), 'pk:score');
  return row.id;
}
