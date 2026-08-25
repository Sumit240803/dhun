import { pool } from '../../infra/db.js';
import { getBalance } from '../economy/index.js';

export interface ProfileSummary {
  publicId: string;
  friends: number;
  following: number;
  followers: number;
  newVisitors: number;
  vipTier: 'silver' | 'gold' | 'diamond' | null;
  userLevel: number;
  hostLevel: number | null;
  points: number;
  verified: boolean;
}

interface Row {
  public_id: string;
  phone_verified_at: Date | null;
  user_level: number | null;
  following: string;
  followers: string;
  friends: string;
  new_visitors: string;
}

/**
 * Everything the Me screen shows that is not a balance.
 *
 * One round trip. Five counts as correlated subqueries rather than five joins,
 * because each hits its own index and none of them multiplies the others'
 * rows — a naive join across follows twice and profile_visits once returns the
 * Cartesian product and reports wildly inflated numbers.
 *
 * Points come from the ledger, never from a column: `account_balances` is a
 * cache the economy module owns, and this reads it through economy's public
 * function rather than touching the table.
 */
export async function getProfileSummary(userId: string): Promise<ProfileSummary> {
  const [{ rows }, points] = await Promise.all([
    pool.query<Row>(
      `SELECT u.public_id,
              u.phone_verified_at,
              s.user_level,

              (SELECT count(*) FROM follows f
                WHERE f.follower_user_id = u.id) AS following,

              (SELECT count(*) FROM follows f
                WHERE f.followee_user_id = u.id) AS followers,

              -- A friend is a follow in BOTH directions. Modelled rather than
              -- stored, so it can never disagree with the follow rows.
              (SELECT count(*) FROM follows a
                JOIN follows b
                  ON b.follower_user_id = a.followee_user_id
                 AND b.followee_user_id = a.follower_user_id
                WHERE a.follower_user_id = u.id) AS friends,

              (SELECT count(*) FROM profile_visits v
                WHERE v.profile_user_id = u.id AND v.seen_at IS NULL) AS new_visitors

         FROM users u
         LEFT JOIN user_stats s ON s.user_id = u.id
        WHERE u.id = $1`,
      [userId],
    ),
    getBalance('user_points', userId),
  ]);

  const row = rows[0];

  return {
    publicId: String(row?.public_id ?? ''),
    friends: Number(row?.friends ?? 0),
    following: Number(row?.following ?? 0),
    followers: Number(row?.followers ?? 0),
    newVisitors: Number(row?.new_visitors ?? 0),
    // Cosmetics are M7 and VIP is one of them. Reported as null rather than
    // omitted, so the client's shape does not change when it lands.
    vipTier: null,
    userLevel: row?.user_level ?? 1,
    // Host levels arrive with host tools in M8.
    hostLevel: null,
    points,
    // PHONE verified, which is what gates money endpoints today. The payout
    // KYC badge — PAN plus face match, hard rule #5 — is a different and
    // stricter check that arrives with payouts in M8.
    verified: row?.phone_verified_at != null,
  };
}
