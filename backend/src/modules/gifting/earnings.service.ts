// A host's earnings, as they see them.
//
// Everything here is READ from what already exists — gift_sends carries the
// points of every gift at the moment it was sent, room_sessions carries the
// hours — so the dashboard can never disagree with the ledger it describes.
// The balance is the ledger's; nothing is summed into a second copy.
//
// No withdraw here. That is M8's payout pipeline, waiting on the CA and
// RazorpayX; this screen shows what has been earned, not what can leave.

import { pool } from '../../infra/db.js';
import { getBalance } from '../economy/index.js';

export interface EarningsDay {
  /** IST calendar date, YYYY-MM-DD. */
  day: string;
  points: number;
  coins: number;
  gifts: number;
}

export interface TopGifter {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  coins: number;
  gifts: number;
}

export interface HostEarnings {
  /** Points on the ledger right now, across every account the host holds them in. */
  pointsBalance: number;
  /**
   * Where those points sit. Gifts land in HELD and move to WITHDRAWABLE when
   * the hold period (7–14 days, M8) releases them; PENDING is a withdrawal
   * already asked for. Until M8 ships everything is held.
   */
  points: { held: number; withdrawable: number; pendingPayout: number };
  window: { days: number; points: number; coins: number; gifts: number; hoursLive: number; rooms: number };
  /** One entry per day in the window, oldest first, zeros included. */
  daily: EarningsDay[];
  topGifters: TopGifter[];
}

const WINDOW_DAYS = 30;

export async function hostEarnings(userId: string): Promise<HostEarnings> {
  const [held, withdrawable, pending, daily, sessions, gifters] = await Promise.all([
    getBalance('host_points_held', userId),
    getBalance('host_points_withdrawable', userId),
    getBalance('host_points_pending_payout', userId),
    pool.query<{ day: string; points: string; coins: string; gifts: string }>(
      // Days in IST, which is the day a host thinks in; a gift at 00:30 belongs
      // to the night it was sent, not to a UTC date.
      `WITH days AS (
         SELECT generate_series(
           (now() AT TIME ZONE 'Asia/Kolkata')::date - ($2::int - 1),
           (now() AT TIME ZONE 'Asia/Kolkata')::date,
           interval '1 day'
         )::date AS day
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(SUM(g.points), 0) AS points,
              COALESCE(SUM(g.coins), 0) AS coins,
              COUNT(g.txn_id) AS gifts
         FROM days d
         LEFT JOIN gift_sends g
           ON g.recipient_user_id = $1
          AND (g.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.day
        GROUP BY d.day
        ORDER BY d.day`,
      [userId, WINDOW_DAYS],
    ),
    // Hours come from room_sessions, which the media server's webhooks write
    // — the time people could actually hear the host. Rooms come from the
    // rooms table, written the moment they go live, so a room the webhook
    // never saw still counts as hosted.
    pool.query<{ seconds: string; rooms: string }>(
      `SELECT (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at))), 0)
                 FROM room_sessions
                WHERE host_user_id = $1 AND started_at >= now() - make_interval(days => $2)) AS seconds,
              (SELECT COUNT(*) FROM rooms
                WHERE host_user_id = $1 AND started_at >= now() - make_interval(days => $2)) AS rooms`,
      [userId, WINDOW_DAYS],
    ),
    pool.query<{
      user_id: string;
      display_name: string | null;
      avatar_url: string | null;
      coins: string;
      gifts: string;
    }>(
      `SELECT g.sender_user_id AS user_id, p.display_name, p.avatar_url,
              SUM(g.coins) AS coins, COUNT(*) AS gifts
         FROM gift_sends g
         LEFT JOIN user_profiles p ON p.user_id = g.sender_user_id
        WHERE g.recipient_user_id = $1 AND g.created_at >= now() - make_interval(days => $2)
        GROUP BY g.sender_user_id, p.display_name, p.avatar_url
        ORDER BY SUM(g.coins) DESC
        LIMIT 10`,
      [userId, WINDOW_DAYS],
    ),
  ]);

  const days = daily.rows.map((r) => ({
    day: r.day,
    points: Number(r.points),
    coins: Number(r.coins),
    gifts: Number(r.gifts),
  }));

  return {
    pointsBalance: held + withdrawable + pending,
    points: { held, withdrawable, pendingPayout: pending },
    window: {
      days: WINDOW_DAYS,
      points: days.reduce((sum, d) => sum + d.points, 0),
      coins: days.reduce((sum, d) => sum + d.coins, 0),
      gifts: days.reduce((sum, d) => sum + d.gifts, 0),
      hoursLive: Math.round((Number(sessions.rows[0]?.seconds ?? 0) / 3600) * 10) / 10,
      rooms: Number(sessions.rows[0]?.rooms ?? 0),
    },
    daily: days,
    topGifters: gifters.rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      coins: Number(r.coins),
      gifts: Number(r.gifts),
    })),
  };
}
