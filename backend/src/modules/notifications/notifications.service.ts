// Push tokens, and the one notification M10 sends: a followed host went live.
//
// growth-plan-v1 calls it the strongest re-engagement driver there is — and a
// notification someone learns to ignore stops being one. So it is spent
// carefully: never twice for one room, once per host per cooldown however often
// they restart, a daily ceiling per person, never across a block, and never
// for a room that has already ended by the time the event is processed.

import { z } from 'zod';
import { pool } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { logger } from '../../infra/logger.js';
import { getConfigValue } from '../economy/index.js';
import { getPushProvider, type PushMessage } from './push.provider.js';

/** Expo's token format. Anything else is a client bug or a probe. */
export const PUSH_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/;

export async function registerPushToken(input: {
  userId: string;
  deviceId: string;
  token: string;
}): Promise<void> {
  const updated = await pool.query(
    'UPDATE user_devices SET push_token = $3, last_seen_at = now() WHERE user_id = $1 AND device_id = $2',
    [input.userId, input.deviceId, input.token],
  );
  if (updated.rowCount === 0) {
    throw new AppError('DEVICE_NOT_FOUND', 'Sign in again on this device', 404);
  }

  // A phone belongs to whoever is signed in on it NOW. Someone who signs out
  // and a different person signs in must not keep receiving the first account's
  // notifications — that is somebody else's private activity on their screen.
  await pool.query(
    'UPDATE user_devices SET push_token = NULL WHERE push_token = $1 AND user_id <> $2',
    [input.token, input.userId],
  );
}

export async function clearPushToken(userId: string, deviceId: string): Promise<void> {
  await pool.query('UPDATE user_devices SET push_token = NULL WHERE user_id = $1 AND device_id = $2', [
    userId,
    deviceId,
  ]);
}

const pushConfigSchema = z.object({
  liveDailyCapPerUser: z.number().int().min(0),
  liveCooldownMinutesPerHost: z.number().int().min(0),
});

async function pushConfig() {
  const parsed = pushConfigSchema.safeParse(await getConfigValue('push'));
  return parsed.success ? parsed.data : { liveDailyCapPerUser: 5, liveCooldownMinutesPerHost: 120 };
}

/** Written server-side because the push is shown before the app is open. */
function liveCopy(locale: string | null, host: string, title: string) {
  return locale?.startsWith('hi')
    ? { title: `${host} अभी लाइव हैं`, body: title }
    : { title: `${host} is live now`, body: title };
}

/**
 * Tells a host's followers they are live.
 *
 * Called by the workers' outbox consumer for `room_started` — at least once.
 * The notification rows are inserted BEFORE sending and only the rows actually
 * inserted are sent, so a retried event sends nothing new.
 */
export async function notifyFollowersLive(event: {
  roomId: string;
  hostId: string;
  title: string;
}): Promise<number> {
  const settings = await pushConfig();
  if (settings.liveDailyCapPerUser === 0) return 0;

  const room = await pool.query<{ live: boolean; host_name: string | null }>(
    `SELECT r.ended_at IS NULL AS live, p.display_name AS host_name
       FROM rooms r LEFT JOIN user_profiles p ON p.user_id = r.host_user_id
      WHERE r.id = $1`,
    [event.roomId],
  );
  // Processed late — the room is already over. "X is live" pointing at an
  // ended room is worse than no notification.
  if (!room.rows[0]?.live) return 0;
  const hostName = room.rows[0].host_name ?? 'Someone you follow';

  const { rows: claimed } = await pool.query<{ follower_user_id: string }>(
    `INSERT INTO live_notifications (follower_user_id, room_id, host_user_id)
     SELECT f.follower_user_id, $1, $2
       FROM follows f
       JOIN users u ON u.id = f.follower_user_id AND u.status = 'active'
      WHERE f.followee_user_id = $2
        AND EXISTS (SELECT 1 FROM user_devices d
                     WHERE d.user_id = f.follower_user_id AND d.push_token IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM blocks b
                         WHERE (b.blocker_user_id = f.follower_user_id AND b.blocked_user_id = $2)
                            OR (b.blocker_user_id = $2 AND b.blocked_user_id = f.follower_user_id))
        AND NOT EXISTS (SELECT 1 FROM live_notifications ln
                         WHERE ln.follower_user_id = f.follower_user_id
                           AND ln.host_user_id = $2
                           AND ln.sent_at > now() - make_interval(mins => $3))
        AND (SELECT count(*) FROM live_notifications ln
              WHERE ln.follower_user_id = f.follower_user_id
                AND ln.sent_at > now() - interval '1 day') < $4
     ON CONFLICT DO NOTHING
     RETURNING follower_user_id`,
    [event.roomId, event.hostId, settings.liveCooldownMinutesPerHost, settings.liveDailyCapPerUser],
  );
  if (claimed.length === 0) return 0;

  const { rows: devices } = await pool.query<{
    user_id: string;
    device_id: string;
    push_token: string;
    locale: string | null;
  }>(
    `SELECT d.user_id, d.device_id, d.push_token, p.locale
       FROM user_devices d
       LEFT JOIN user_profiles p ON p.user_id = d.user_id
      WHERE d.user_id = ANY($1::uuid[]) AND d.push_token IS NOT NULL`,
    [claimed.map((row) => row.follower_user_id)],
  );

  const messages: PushMessage[] = devices.map((device) => ({
    token: device.push_token,
    ...liveCopy(device.locale, hostName, event.title),
    data: { type: 'room_live', roomId: event.roomId },
  }));

  const outcomes = await getPushProvider().send(messages);

  // Dead tokens are cleared, so tomorrow's room does not try them again.
  const dead = devices.filter((_, index) => {
    const outcome = outcomes[index];
    return outcome && !outcome.ok && outcome.unregistered;
  });
  for (const device of dead) {
    await pool.query(
      'UPDATE user_devices SET push_token = NULL WHERE user_id = $1 AND device_id = $2 AND push_token = $3',
      [device.user_id, device.device_id, device.push_token],
    );
  }

  const failed = outcomes.filter((outcome) => !outcome.ok).length;
  logger.info('live notifications sent', {
    room_id: event.roomId,
    followers: claimed.length,
    devices: messages.length,
    failed,
  });
  return messages.length - failed;
}
