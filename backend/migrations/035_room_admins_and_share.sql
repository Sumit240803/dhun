-- ---------------------------------------------------------------------------
-- 035 · Room admins, and where a shared room link points
--
-- Phase 0 host tools (app-blueprint-v1): "room admin appoint, mute/kick". A
-- host running a twenty-seat hall cannot also watch the queue and the chat;
-- they hand that to one or two people they trust, for THIS room only.
-- ---------------------------------------------------------------------------

-- An admin is per room and dies with it (ON DELETE CASCADE). Nothing about a
-- person carries over to the host's next room — they are appointed again,
-- which is one tap and keeps "who can silence people in here" a decision the
-- host makes every time rather than a role that quietly persists.
CREATE TABLE room_admins (
  room_id       uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  appointed_by  uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

-- The web address a shared room link carries: {base}/r/{room code}. The API
-- serves that page itself at /r/:code; the domain in front proxies to it.
-- Config, so moving from the API's own host to dhun.live is a row, not a release.
INSERT INTO app_config (key, value, description) VALUES
  ('share_base_url', '"https://dhun.live"'::jsonb,
   'Base of a shared room link, without a trailing slash. The API answers {base}/r/{code} with a landing page that opens the app or sends to the store.')
ON CONFLICT (key) DO NOTHING;
