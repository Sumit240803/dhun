-- ============================================================================
-- 030 · Cosmetics earned by level, rather than bought
--
-- `cosmetics.free_at_user_level` has existed since migration 003. `frame_basic`
-- says free at level 31 and `entry_basic` says free at level 16, both are
-- returned to the client in the catalog — and NOTHING HAS EVER READ THE COLUMN.
-- No user has ever been granted either one.
--
-- That is a promise in the data the code does not keep, which is worse than not
-- having made it: the app can legitimately show "free at level 31" on an item
-- nobody will ever receive.
--
-- ── Why `expires_at` becomes nullable ───────────────────────────────────────
--
-- A bought cosmetic rents for `duration_days`. One earned by reaching a level
-- is not a rental — the level does not expire, so neither should the reward,
-- and a frame that vanished thirty days after you earned it would read as a
-- bug rather than a lapse.
--
-- NULL therefore means "never expires". The alternative considered was a
-- far-future date, which keeps the column NOT NULL and reads fine in every
-- query — and encodes "forever" as a magic number that somebody eventually
-- compares against or formats into a UI. Four read sites change; a magic date
-- would have changed none of them and been wrong in all of them.
--
-- ── Why `source` ────────────────────────────────────────────────────────────
--
-- Support will be asked why a user has a frame they never bought. Without this
-- the only answer is to infer it from a null expiry, which stops being true the
-- moment a second kind of free grant exists (an event, an apology, a gift).
-- ============================================================================

ALTER TABLE user_cosmetics
  ALTER COLUMN expires_at DROP NOT NULL;

COMMENT ON COLUMN user_cosmetics.expires_at IS
  'When this item stops being drawn. NULL means never — it was earned by '
  'reaching a level, and levels do not expire. Every read must therefore be '
  '(expires_at IS NULL OR expires_at > now()), never expires_at > now().';

ALTER TABLE user_cosmetics
  ADD COLUMN source text NOT NULL DEFAULT 'purchase'
    CHECK (source IN ('purchase', 'level'));

COMMENT ON COLUMN user_cosmetics.source IS
  'How it was acquired. Answers the support question "why does this user have '
  'a frame they never bought". Upgrading a bought item to a level unlock sets '
  'this to level and clears the expiry; the reverse never happens.';

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Everybody who already qualifies gets theirs now. Without this, the feature
-- only works for people who make a purchase AFTER today — and a user sitting
-- at level 31 would watch the unlock never arrive.
--
-- Level is derived from lifetime PURCHASED coins (never free ones, or daily
-- check-ins could be ground into levels), so this reads the same stat the
-- purchase path does.
-- ---------------------------------------------------------------------------
INSERT INTO user_cosmetics (user_id, cosmetic_id, kind, expires_at, equipped, source)
SELECT s.user_id, c.id, c.kind, NULL, false, 'level'
  FROM user_stats s
  -- The same derivation `levelFor('user', ...)` does in code: the highest
  -- threshold this user's lifetime purchased coins have reached, floor of 1.
  JOIN LATERAL (
    SELECT COALESCE(MAX(lt.level), 1) AS level
      FROM level_thresholds lt
     WHERE lt.kind = 'user'
       AND s.lifetime_purchased_coins >= lt.min_value
  ) lv ON true
  JOIN cosmetics c
    ON c.free_at_user_level IS NOT NULL
   AND c.is_active
 WHERE lv.level >= c.free_at_user_level
ON CONFLICT (user_id, cosmetic_id) DO UPDATE
   SET expires_at = NULL,
       source = 'level';
