// The admin panel's routes.
//
// Server-rendered HTML on the API that already exists: one thing to deploy,
// one auth system, one set of modules, and no second frontend to keep alive
// before there is a first user. Day-1 non-negotiable #10 — the panel is part
// of the MVP, not "later".
//
// ── What it is not ──────────────────────────────────────────────────────────
//
// Not a JSON API with a UI bolted on. Every page is a GET that renders, every
// action is a POST that redirects. No client-side state, so there is nothing
// to get out of sync and nothing to debug at 11pm except the server.

import { Router, urlencoded } from 'express';
import { config } from '../config/index.js';
import { pool } from '../infra/db.js';
import { AppError } from '../infra/errors.js';
import { logger } from '../infra/logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { verifyPassword } from '../modules/auth/password.js';
import {
  decideFaceCheck,
  decideVerification,
  enforce,
  enforcementHistory,
  pendingFaceChecks,
  pendingVerifications,
  queueCounts,
  recentEnforcement,
} from '../modules/verification/index.js';
import { html } from './html.js';
import { ADMIN_CSS, flash, loginPage, page, type Nav } from './layout.js';
import {
  logPage,
  queuePage,
  roomsPage,
  userPage,
  usersPage,
  type LiveRoomRow,
  type UserRow,
} from './pages.js';
import {
  clearSession,
  currentStaffRoles,
  issueSession,
  loadSession,
  requireCsrf,
  requireRoles,
  requireSession,
} from './session.js';

/** Actions only a lead or an admin may take. A moderator can flag, not suspend. */
const CAN_SUSPEND = ['super_admin', 'ops_manager', 'ts_lead'];

export function buildAdminRouter(): Router {
  const router = Router();

  /**
   * The API's own policy is `default-src 'none'`, which is right for a JSON
   * API and would leave the panel with no stylesheet and no face images —
   * which are the entire point of the review queue.
   *
   * So the panel states its own, tightly: its stylesheet from itself, images
   * from itself and from the bucket holding the photos, and NO script at all.
   * There is no JavaScript on any of these pages, so `script-src 'none'` costs
   * nothing and closes the hole an injected tag would otherwise find.
   */
  router.use((_req, res, next) => {
    const img = ["'self'", 'data:', mediaOrigin()].filter(Boolean).join(' ');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "style-src 'self'",
        `img-src ${img}`,
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "script-src 'none'",
      ].join('; '),
    );
    next();
  });

  /** The stylesheet, as a file, so no page needs an inline <style>. */
  router.get('/style.css', (_req, res) => {
    res.type('css').setHeader('Cache-Control', 'public, max-age=300').send(ADMIN_CSS);
  });

  // Forms, not JSON. The API's own body parser never sees these routes because
  // the panel is mounted before it.
  router.use(urlencoded({ extended: false, limit: '32kb' }));
  router.use(loadSession);

  // ── Sign in ─────────────────────────────────────────────────────────────

  router.get('/login', (req, res) => {
    if (req.staff) return res.redirect('/admin/queue');
    res.type('html').send(loginPage(typeof req.query.error === 'string' ? req.query.error : null));
  });

  router.post(
    '/login',
    // Tight, and by IP: this is a password form on the internet.
    rateLimit({ scope: 'admin:login', limit: 10, windowMs: 900_000, by: 'ip' }),
    async (req, res, next) => {
      try {
        const email = String(req.body.email ?? '').trim().toLowerCase();
        const password = String(req.body.password ?? '');

        const { rows } = await pool.query<{
          id: string;
          password_hash: string | null;
          display_name: string | null;
        }>(
          `SELECT u.id, u.password_hash, p.display_name
             FROM users u
             LEFT JOIN user_profiles p ON p.user_id = u.id
            WHERE lower(u.email) = $1 AND u.status = 'active'`,
          [email],
        );
        const user = rows[0];

        // One message for every failure. "No such account" and "wrong
        // password" told apart is an account enumeration oracle, and this form
        // is the front door to the back office.
        const ok =
          user?.password_hash != null && (await verifyPassword(password, user.password_hash));
        const roles = ok ? await currentStaffRoles(user!.id) : [];

        if (!ok || roles.length === 0) {
          logger.warn('admin sign-in refused', { email, reason: ok ? 'not_staff' : 'bad_password' });
          return res.redirect('/admin/login?error=' + encodeURIComponent('Wrong email or password.'));
        }

        await issueSession(res, {
          userId: user!.id,
          name: user!.display_name ?? email,
          roles,
        });
        logger.info('admin signed in', { user_id: user!.id, roles });
        res.redirect('/admin/queue');
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/logout', (req, res) => {
    clearSession(res);
    res.redirect('/admin/login');
  });

  // ── Everything below needs a session ────────────────────────────────────

  router.use(requireSession);

  async function nav(req: Parameters<typeof requireSession>[0], active: Nav['active']): Promise<Nav> {
    return { active, counts: await queueCounts(), staffName: req.staff!.name };
  }

  router.get('/', (_req, res) => res.redirect('/admin/queue'));

  // ── The review queue ────────────────────────────────────────────────────

  router.get('/queue', async (req, res, next) => {
    try {
      const [verifications, checks] = await Promise.all([
        pendingVerifications(),
        pendingFaceChecks(),
      ]);
      res.type('html').send(
        page(
          await nav(req, 'queue'),
          'Review queue',
          html`${flash(asText(req.query.ok))}
            ${queuePage({ verifications, checks, csrf: req.staff!.csrf })}`,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.post('/queue/verification', requireCsrf, async (req, res, next) => {
    try {
      const userId = String(req.body.userId ?? '');
      const approve = req.body.decision === 'approve';

      await decideVerification({
        userId,
        reviewerId: req.staff!.userId,
        approve,
        note: asText(req.body.note) || undefined,
      });
      res.redirect(
        '/admin/queue?ok=' + encodeURIComponent(approve ? 'Photo approved.' : 'Photo rejected.'),
      );
    } catch (err) {
      next(err);
    }
  });

  /**
   * One form, five outcomes.
   *
   * Deciding the frame and acting on it are separate writes on purpose: the
   * check records what a reviewer SAW, the enforcement log records what they
   * DID. A mismatch that led to nothing and a mismatch that led to a
   * suspension must not look the same afterwards.
   */
  router.post('/queue/check', requireCsrf, async (req, res, next) => {
    try {
      const checkId = String(req.body.checkId ?? '');
      const decision = String(req.body.decision ?? '');

      const outcome =
        decision === 'ok' ? 'ok' : decision === 'unclear' ? 'unclear' : 'mismatch';
      const { userId, roomId } = await decideFaceCheck({
        checkId,
        reviewerId: req.staff!.userId,
        status: outcome,
      });

      if (decision === 'flag' || decision === 'suspend' || decision === 'end_room') {
        if (decision === 'suspend' && !req.staff!.roles.some((r) => CAN_SUSPEND.includes(r))) {
          throw new AppError('FORBIDDEN', 'Only a lead can suspend a host', 403);
        }
        await enforce({
          actorId: req.staff!.userId,
          action: decision,
          subjectType: decision === 'end_room' ? 'room' : 'user',
          subjectId: decision === 'end_room' ? roomId : userId,
          source: 'face_check',
          sourceId: checkId,
          note: asText(req.body.note) || undefined,
        });
      }

      res.redirect('/admin/queue?ok=' + encodeURIComponent('Recorded.'));
    } catch (err) {
      next(err);
    }
  });

  // ── Live rooms ──────────────────────────────────────────────────────────

  router.get('/rooms', async (req, res, next) => {
    try {
      const { rows } = await pool.query<{
        id: string;
        public_id: string;
        title: string;
        host_user_id: string;
        host_name: string | null;
        viewer_count: number;
        started_at: Date;
        flagged: boolean;
      }>(
        `SELECT r.id, r.public_id, r.title, r.host_user_id, p.display_name AS host_name,
                r.viewer_count, r.started_at, (u.host_flagged_at IS NOT NULL) AS flagged
           FROM rooms r
           JOIN users u ON u.id = r.host_user_id
           LEFT JOIN user_profiles p ON p.user_id = r.host_user_id
          WHERE r.ended_at IS NULL
          ORDER BY r.viewer_count DESC
          LIMIT 200`,
      );

      const rooms: LiveRoomRow[] = rows.map((row) => ({
        id: row.id,
        publicId: Number(row.public_id),
        title: row.title,
        hostId: row.host_user_id,
        hostName: row.host_name,
        viewers: row.viewer_count,
        startedAt: row.started_at.toISOString(),
        flagged: row.flagged,
      }));

      res.type('html').send(
        page(
          await nav(req, 'rooms'),
          'Live rooms',
          html`${flash(asText(req.query.ok))}${roomsPage(rooms, req.staff!.csrf)}`,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.post('/rooms/end', requireCsrf, async (req, res, next) => {
    try {
      await enforce({
        actorId: req.staff!.userId,
        action: 'end_room',
        subjectType: 'room',
        subjectId: String(req.body.roomId ?? ''),
        source: 'manual',
        note: asText(req.body.note) || undefined,
      });
      res.redirect('/admin/rooms?ok=' + encodeURIComponent('Room ended.'));
    } catch (err) {
      next(err);
    }
  });

  // ── Users ───────────────────────────────────────────────────────────────

  router.get('/users', async (req, res, next) => {
    try {
      const query = asText(req.query.q).slice(0, 60);
      const results = query === '' ? [] : await findUsers(query);
      res.type('html').send(
        page(
          await nav(req, 'users'),
          'Users',
          html`${flash(asText(req.query.ok))}${usersPage(query, results)}`,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/users/:id', async (req, res, next) => {
    try {
      const user = await findUserById(req.params.id);
      if (!user) return res.status(404).send('No such user.');

      const [history, checks] = await Promise.all([
        enforcementHistory('user', user.id),
        pool.query<{ created_at: Date; status: string; reason: string }>(
          'SELECT created_at, status, reason FROM face_checks WHERE user_id = $1' +
            ' ORDER BY created_at DESC LIMIT 20',
          [user.id],
        ),
      ]);

      res.type('html').send(
        page(
          await nav(req, 'users'),
          user.displayName ?? 'User',
          html`${flash(asText(req.query.ok))}
            ${userPage({
              user,
              history,
              recentChecks: checks.rows.map((row) => ({
                at: row.created_at.toISOString(),
                status: row.status,
                reason: row.reason,
              })),
              csrf: req.staff!.csrf,
            })}`,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/users/action',
    requireCsrf,
    // Flagging is reversible and invisible; suspending stops somebody earning.
    // A content moderator may do the first and not the second.
    async (req, res, next) => {
      try {
        const action = String(req.body.action ?? '');
        const userId = String(req.body.userId ?? '');

        if (!['flag', 'clear_flag', 'suspend', 'unsuspend'].includes(action)) {
          throw new AppError('BAD_ACTION', 'Unknown action', 422);
        }
        if (
          (action === 'suspend' || action === 'unsuspend') &&
          !req.staff!.roles.some((r) => CAN_SUSPEND.includes(r))
        ) {
          throw new AppError('FORBIDDEN', 'Only a lead can suspend a host', 403);
        }

        await enforce({
          actorId: req.staff!.userId,
          action: action as 'flag' | 'clear_flag' | 'suspend' | 'unsuspend',
          subjectType: 'user',
          subjectId: userId,
          source: 'manual',
          note: asText(req.body.note) || undefined,
        });
        res.redirect(`/admin/users/${encodeURIComponent(userId)}?ok=` + encodeURIComponent('Done.'));
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Enforcement log ─────────────────────────────────────────────────────

  router.get('/log', requireRoles(...CAN_SUSPEND, 'content_moderator'), async (req, res, next) => {
    try {
      res.type('html').send(
        page(await nav(req, 'log'), 'Enforcement log', logPage(await recentEnforcement())),
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * The origin serving host photos, for the image policy.
 *
 * Empty when R2 is not configured — then the queue shows broken images rather
 * than a blocked page, which is the right way round: the panel still works and
 * the missing configuration is obvious.
 */
function mediaOrigin(): string {
  const url = config.media.publicUrl;
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Query strings are `string | string[] | ParsedQs`; this is the only shape we want. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function findUsers(query: string): Promise<UserRow[]> {
  const asNumber = /^\d+$/.test(query) ? Number(query) : null;

  const { rows } = await pool.query<UserRowShape>(
    `${USER_SELECT}
      WHERE ($2::bigint IS NOT NULL AND u.public_id = $2)
         OR (p.display_name ILIKE $1 || '%')
      ORDER BY u.created_at DESC
      LIMIT 50`,
    [query, asNumber],
  );
  return rows.map(toUserRow);
}

async function findUserById(id: string): Promise<UserRow | null> {
  // A malformed uuid must be a 404, not a database error on a cast.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await pool.query<UserRowShape>(`${USER_SELECT} WHERE u.id = $1`, [id]);
  return rows[0] ? toUserRow(rows[0]) : null;
}

interface UserRowShape {
  id: string;
  public_id: string;
  display_name: string | null;
  phone_e164: string | null;
  verification: string | null;
  flagged: boolean;
  suspended: boolean;
  created_at: Date;
}

const USER_SELECT = `
  SELECT u.id, u.public_id, p.display_name, u.phone_e164,
         v.status AS verification,
         (u.host_flagged_at IS NOT NULL) AS flagged,
         (u.host_suspended_at IS NOT NULL) AS suspended,
         u.created_at
    FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
    LEFT JOIN host_verifications v ON v.user_id = u.id`;

function toUserRow(row: UserRowShape): UserRow {
  return {
    id: row.id,
    publicId: Number(row.public_id),
    displayName: row.display_name,
    phone: row.phone_e164,
    verification: row.verification ?? 'none',
    flagged: row.flagged,
    suspended: row.suspended,
    createdAt: row.created_at.toISOString(),
  };
}
