-- ===========================================================================
-- 006_social — rooms, follows, threads, banners, profile visits
--
-- The READ side of the feed. Everything here can be listed, and nothing here
-- can be joined, broadcast to, or chatted in — that is M5, and it depends on
-- the realtime gateway and an RTC vendor that is still undecided.
--
-- Splitting it this way is deliberate: the room LIST is what the app opens on,
-- it is what host seeding fills, and none of its shape changes whichever vendor
-- wins. Building it now unblocks the app; building the join flow now would mean
-- guessing at a token exchange we cannot yet write.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- users.public_id
--
-- The short number a user reads out to be found, tipped, or invited. NOT the
-- internal uuid: that appears in logs and in every foreign key, and a value
-- people paste into WhatsApp should never be the same string that identifies
-- the row. Eight digits, from a sequence, so it is short enough to say aloud.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE user_public_id_seq START 10000000;

ALTER TABLE users
  ADD COLUMN public_id bigint NOT NULL UNIQUE DEFAULT nextval('user_public_id_seq');


-- ---------------------------------------------------------------------------
-- rooms
--
-- One row per room, live or ended. Rooms are NOT deleted when they end: the
-- history is what host earnings, moderation review and the "you were watching"
-- resume all read from, and a deleted row takes its gift ledger context with it.
-- ---------------------------------------------------------------------------
CREATE TABLE rooms (
  id             uuid PRIMARY KEY,
  host_user_id   uuid NOT NULL REFERENCES users(id),
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 60),

  -- What the room is FOR. Browsed by, and shown as the card's badge — nobody
  -- opens a live app looking for "content", they want singing, or company.
  tag            text NOT NULL CHECK (tag IN ('singing','dancing','chatting','gaming','friends','esports')),

  -- ISO 3166-1 alpha-2. Denormalised from the host's profile so the feed query
  -- never joins to filter by region, which is the most common filter there is.
  country        text NOT NULL DEFAULT 'IN',

  cover_url      text,

  -- Video or audio-only. Audio rooms are cheaper to run and are the likely
  -- niche (open decision #1), so this is a first-class field, not a flag on a
  -- settings blob.
  is_video       boolean NOT NULL DEFAULT true,

  -- NULL for a single-host live room; a number for a party room with seats.
  -- The presence of this is what tells the two apart in one query.
  seat_capacity  smallint CHECK (seat_capacity IS NULL OR seat_capacity BETWEEN 2 AND 20),
  seats_taken    smallint NOT NULL DEFAULT 0 CHECK (seats_taken >= 0),

  -- Denormalised, updated by the realtime gateway on a timer. A COUNT over a
  -- presence table on every feed request would be the first thing to fall over.
  viewer_count   integer NOT NULL DEFAULT 0 CHECK (viewer_count >= 0),

  started_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,

  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rooms_seats_within_capacity
    CHECK (seat_capacity IS NULL OR seats_taken <= seat_capacity)
);

-- The feed query: live rooms, most watched first. Partial index because ended
-- rooms are the overwhelming majority within a week and are never in the feed.
CREATE INDEX rooms_live_idx ON rooms (viewer_count DESC, started_at DESC)
  WHERE ended_at IS NULL;

CREATE INDEX rooms_host_idx ON rooms (host_user_id, started_at DESC);

-- A host may have only ONE live room. Without this a reconnect storm creates a
-- second room, the feed shows both, and the gifts split across them.
CREATE UNIQUE INDEX rooms_one_live_per_host_idx ON rooms (host_user_id)
  WHERE ended_at IS NULL;


-- ---------------------------------------------------------------------------
-- follows
--
-- Directed. `follower` chose to see `followee`; nothing is reciprocal, and a
-- "friend" is simply a pair of rows in both directions.
-- ---------------------------------------------------------------------------
CREATE TABLE follows (
  follower_user_id uuid NOT NULL REFERENCES users(id),
  followee_user_id uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (follower_user_id, followee_user_id),
  CONSTRAINT follows_not_self CHECK (follower_user_id <> followee_user_id)
);

-- "Who do I follow" — the Following feed.
CREATE INDEX follows_follower_idx ON follows (follower_user_id, created_at DESC);
-- "Who follows me" — the follower count and the notification fan-out.
CREATE INDEX follows_followee_idx ON follows (followee_user_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- profile_visits
--
-- Who looked at whose profile. One row per viewer per profile, refreshed —
-- not append-only — because the product question is "who has been looking",
-- not "how many times did they look", and the append-only version grows
-- without bound for a popular host.
-- ---------------------------------------------------------------------------
CREATE TABLE profile_visits (
  profile_user_id uuid NOT NULL REFERENCES users(id),
  viewer_user_id  uuid NOT NULL REFERENCES users(id),
  visited_at      timestamptz NOT NULL DEFAULT now(),
  -- Cleared when the owner opens their visitors list. What "3 new" counts.
  seen_at         timestamptz,

  PRIMARY KEY (profile_user_id, viewer_user_id),
  CONSTRAINT profile_visits_not_self CHECK (profile_user_id <> viewer_user_id)
);

CREATE INDEX profile_visits_recent_idx ON profile_visits (profile_user_id, visited_at DESC);


-- ---------------------------------------------------------------------------
-- message_threads
--
-- Direct, group, and OFFICIAL. Official threads are platform-sent — payout
-- notices, security alerts, policy warnings — and they carry a badge, cannot
-- be deleted by the user and cannot be replied to. That is not a UI decision:
-- a user who mutes the thread that says "your payout failed" generates a
-- support ticket, and IT Rules 2021 require a reachable channel.
-- ---------------------------------------------------------------------------
CREATE TABLE message_threads (
  id         uuid PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('direct','group','official')),
  -- Group and official threads have a title; a direct thread takes its title
  -- from the other participant and stores NULL.
  title      text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 60),
  -- Which system voice sent it, so the client can tint the avatar without
  -- parsing the title. NULL for user threads.
  accent     text CHECK (accent IS NULL OR accent IN ('money','security','system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT message_threads_official_has_title
    CHECK (kind <> 'official' OR title IS NOT NULL)
);

CREATE TRIGGER message_threads_updated_at BEFORE UPDATE ON message_threads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE thread_participants (
  thread_id    uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id),
  -- Everything after this is unread. A timestamp rather than a counter: a
  -- counter has to be decremented correctly from several places and drifts,
  -- where a watermark is idempotent and survives a message being deleted.
  last_read_at timestamptz,
  joined_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX thread_participants_user_idx ON thread_participants (user_id);


CREATE TABLE messages (
  id             uuid PRIMARY KEY,
  thread_id      uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  -- NULL for a platform message. Not a magic system user id: a real row would
  -- be reachable by a direct message and appear in search.
  sender_user_id uuid REFERENCES users(id),
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The thread view, newest first, and the unread count's range scan.
CREATE INDEX messages_thread_idx ON messages (thread_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- banners
--
-- The campaign strip above the feed. Server-driven from day one (non-negotiable
-- #6): a campaign must never need an app release, and a bad one must be
-- killable in seconds by flipping is_active.
--
-- ⚠️ HARD RULE #1. An event may be a RANKING — who sent or received the most,
-- over a window, from a published pool. It may never be chance: no lucky box,
-- no mystery gift, no wheel. `action` is a closed set for exactly that reason,
-- so a row cannot invent a destination the client did not agree to.
-- ---------------------------------------------------------------------------
CREATE TABLE banners (
  id         uuid PRIMARY KEY,
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  subtitle   text NOT NULL CHECK (length(subtitle) BETWEEN 1 AND 120),
  -- NULL for an evergreen banner. Drives the countdown.
  ends_at    timestamptz,
  action     text NOT NULL CHECK (action IN ('ranking','rewards','topup','none')),
  -- The server names a theme; the CLIENT owns the palette. A config row must
  -- never carry a hex value, or a bad campaign paints an unreadable banner and
  -- the only fix is a release.
  theme      text NOT NULL CHECK (theme IN ('gold','rose','violet')),
  sort_order smallint NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX banners_active_idx ON banners (sort_order, created_at)
  WHERE is_active;
