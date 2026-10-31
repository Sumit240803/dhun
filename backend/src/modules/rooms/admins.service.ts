// Room admins — people the host trusts to mute and remove in this room.
//
// Per room, never per person: the list dies with the room. The host is the
// only one who appoints and removes; an admin can mute and kick anyone who is
// neither the host nor another admin. The cap is small on purpose — a room
// with ten admins has no admin.

import { pool } from '../../infra/db.js';
import { publishToRoom } from '../../infra/roomBus.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';

export const MAX_ROOM_ADMINS = 5;

export async function listAdmins(roomId: string): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM room_admins WHERE room_id = $1 ORDER BY created_at',
    [roomId],
  );
  return rows.map((r) => r.user_id);
}

export async function isAdmin(roomId: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM room_admins WHERE room_id = $1 AND user_id = $2',
    [roomId, userId],
  );
  return (rowCount ?? 0) > 0;
}

async function liveRoomHost(roomId: string): Promise<string> {
  const { rows } = await pool.query<{ host_user_id: string; ended_at: Date | null }>(
    'SELECT host_user_id, ended_at FROM rooms WHERE id = $1',
    [roomId],
  );
  if (!rows[0]) throw new AppError('ROOM_NOT_FOUND', 'That room does not exist', 404);
  if (rows[0].ended_at !== null) throw new AppError('ROOM_ENDED', 'This room has ended', 410);
  return rows[0].host_user_id;
}

/** Everyone in the room learns the new list; the client re-derives who may do what. */
async function announce(roomId: string): Promise<void> {
  publishToRoom(roomId, { t: 'admins', roomId, admins: await listAdmins(roomId) });
}

export async function appointAdmin(input: {
  roomId: string;
  hostId: string;
  userId: string;
}): Promise<string[]> {
  const host = await liveRoomHost(input.roomId);
  if (host !== input.hostId) throw new AppError('NOT_ROOM_HOST', 'Only the host can do that', 403);
  if (input.userId === host) {
    throw new AppError('CANNOT_ADMIN_HOST', 'The host already runs the room', 409);
  }

  const { rows } = await pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
    input.userId,
  ]);
  // A guest has no account to be trusted with; a banned user has forfeited it.
  if (rows[0]?.status !== 'active') {
    throw new AppError('ADMIN_MUST_BE_REGISTERED', 'Only a registered account can be an admin', 409);
  }

  const { rows: count } = await pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM room_admins WHERE room_id = $1',
    [input.roomId],
  );
  if (Number(count[0]?.n ?? 0) >= MAX_ROOM_ADMINS) {
    throw new AppError('ROOM_ADMINS_FULL', `A room has at most ${MAX_ROOM_ADMINS} admins`, 409, {
      max: MAX_ROOM_ADMINS,
    });
  }

  await pool.query(
    `INSERT INTO room_admins (room_id, user_id, appointed_by) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [input.roomId, input.userId, input.hostId],
  );
  logger.info('room admin appointed', { room_id: input.roomId, user_id: input.userId });
  await announce(input.roomId);
  return listAdmins(input.roomId);
}

export async function removeAdmin(input: {
  roomId: string;
  hostId: string;
  userId: string;
}): Promise<string[]> {
  const host = await liveRoomHost(input.roomId);
  if (host !== input.hostId) throw new AppError('NOT_ROOM_HOST', 'Only the host can do that', 403);

  await pool.query('DELETE FROM room_admins WHERE room_id = $1 AND user_id = $2', [
    input.roomId,
    input.userId,
  ]);
  logger.info('room admin removed', { room_id: input.roomId, user_id: input.userId });
  await announce(input.roomId);
  return listAdmins(input.roomId);
}
