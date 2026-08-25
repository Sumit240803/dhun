import { pool } from '../../infra/db.js';

export interface Banner {
  id: string;
  title: string;
  subtitle: string;
  endsAt: Date | null;
  action: 'ranking' | 'rewards' | 'topup' | 'none';
  theme: 'gold' | 'rose' | 'violet';
}

interface Row {
  id: string;
  title: string;
  subtitle: string;
  ends_at: Date | null;
  action: string;
  theme: string;
}

/**
 * Active campaign banners, in display order.
 *
 * Server-driven from day one (non-negotiable #6): a campaign must never need
 * an app release, and a bad banner must be killable in seconds by flipping
 * is_active — which is the same reason the gift catalog lives in the database.
 *
 * Expired banners are filtered HERE rather than by a job. A banner whose
 * countdown has run out is worse than no banner, and relying on a sweep means
 * it lingers for however long the sweep interval is.
 */
export async function listBanners(): Promise<Banner[]> {
  const { rows } = await pool.query<Row>(
    `SELECT id, title, subtitle, ends_at, action, theme
       FROM banners
      WHERE is_active
        AND (ends_at IS NULL OR ends_at > now())
      ORDER BY sort_order, created_at`,
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    endsAt: row.ends_at,
    action: row.action as Banner['action'],
    theme: row.theme as Banner['theme'],
  }));
}
