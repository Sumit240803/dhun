-- ---------------------------------------------------------------------------
-- 025 · Uploaded images: store the KEY, keep the URL beside it
--
-- Avatars and room covers are uploaded to Cloudflare R2. Both tables already
-- hold a URL and every read path uses it, so the URL stays exactly where it is
-- and a KEY is added next to it.
--
-- WHY BOTH. A key (`avatars/{user}/{uuid}.jpg`) is what the object actually is;
-- the URL is only that key under whichever domain serves the bucket today. The
-- first domain will be the `r2.dev` one Cloudflare hands out, which they
-- rate-limit and advise against for production — so it WILL be replaced by
-- something like media.dhun.live.
--
-- Keeping the key means that move is one UPDATE that recomputes every URL from
-- the keys, instead of a migration that tries to rewrite URLs with string
-- surgery and corrupts the ones that do not match the pattern. Keeping the URL
-- materialised means no read path changes at all — the gateway, profiles,
-- seats, chat and leaderboards all keep reading the column they already read.
--
-- A NULL key with a non-NULL URL is legitimate: seeded covers point at a
-- placeholder service we do not own, and there is no key for those.
-- ---------------------------------------------------------------------------

ALTER TABLE user_profiles ADD COLUMN avatar_key text;
ALTER TABLE rooms ADD COLUMN cover_key text;

-- Finding every object still served from an old domain, when the domain moves.
CREATE INDEX idx_user_profiles_avatar_key ON user_profiles (avatar_key)
  WHERE avatar_key IS NOT NULL;
CREATE INDEX idx_rooms_cover_key ON rooms (cover_key)
  WHERE cover_key IS NOT NULL;
