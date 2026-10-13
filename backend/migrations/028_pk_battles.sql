-- ============================================================================
-- 028 · PK battles
--
-- Two hosts compete for a fixed window and each one's audience pays to push
-- their side of the bar. It is the biggest gifting mechanic in this category
-- and the reason the room's PK stage was built (mobile/src/features/room/pk).
--
-- ── WHAT THIS IS NOT, AND WHY THAT MATTERS ──────────────────────────────────
--
-- It is a SCOREBOARD. It moves no money and touches no ledger table.
--
-- Every gift sent during a battle has already been paid to the host it was
-- addressed to, by `gifting`, through the ledger, at the moment it was sent —
-- battle or no battle. PK reads those gifts and adds them up. Nothing here
-- settles anything.
--
-- That is a legal boundary, not a design preference. Pool the two audiences'
-- gifts and hand the pot to the winner, or refund the losing side, and gifting
-- stops being a purchase and becomes a wager on an uncertain outcome — an
-- online money game under the Promotion and Regulation of Online Gaming Act
-- 2025, which is hard rule #1 and treated as an existential risk. The
-- `games` module header says the same thing; this is where it becomes schema.
--
-- The consequence worth stating plainly: there are no prize columns in this
-- file, and there must never be any.
--
-- ── SCORES ARE DERIVED, NOT ACCUMULATED ─────────────────────────────────────
--
-- `pk_battles` stores no running total. A battle's score is a SUM over
-- `gift_sends` for that host inside the window, served by the index 015 already
-- created (`gift_sends_recipient_idx` on recipient + created_at).
--
-- The same reasoning as the ledger's balances: a mutable counter can disagree
-- with the events it summarises, and the disagreement is invisible. A gift
-- reversed by moderation, an event replayed, a battle whose window is corrected
-- — each of those silently corrupts a counter and changes nothing in a SUM.
-- `commission_attributions` are derived at period close for the same reason.
--
-- The settled result IS stored, because it is a historical fact rather than a
-- running figure: once the whistle goes, who won is not recomputed.
-- ============================================================================

CREATE TABLE pk_battles (
  id             uuid PRIMARY KEY,

  -- '1v1' is two hosts. 'team' is the same bar with a roster behind each side;
  -- the roster lives in pk_battle_members.
  mode           text NOT NULL DEFAULT '1v1' CHECK (mode IN ('1v1', 'team')),

  state          text NOT NULL CHECK (state IN ('pending', 'live', 'ended', 'cancelled')),

  -- Both rooms, and both hosts. The host is denormalised from the room rather
  -- than joined because a room's host cannot change but a room can end, and the
  -- battle still has to name who fought it afterwards.
  home_room_id   uuid NOT NULL REFERENCES rooms(id),
  away_room_id   uuid NOT NULL REFERENCES rooms(id),
  home_user_id   uuid NOT NULL REFERENCES users(id),
  away_user_id   uuid NOT NULL REFERENCES users(id),

  -- The window. Gifts are counted on `created_at >= started_at AND < ends_at`,
  -- so both are needed and both are fixed once the battle goes live. Extending
  -- a live battle would retroactively change who was winning.
  started_at     timestamptz,
  ends_at        timestamptz,

  settled_at     timestamptz,
  -- NULL after settling means a DRAW, which is why `state` is the field that
  -- says whether it is over. Reading a null winner as "not finished" was the
  -- obvious mistake waiting to be made here.
  winner_user_id uuid REFERENCES users(id),
  -- Frozen at settlement, from the same SUM the live score uses. Stored so the
  -- result survives a gift being reversed afterwards.
  home_score     bigint NOT NULL DEFAULT 0 CHECK (home_score >= 0),
  away_score     bigint NOT NULL DEFAULT 0 CHECK (away_score >= 0),

  -- Why it ended early, when it did: 'host_left', 'room_ended', 'declined',
  -- 'expired', 'admin'. Null for a battle that ran its course.
  cancelled_reason text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- A host cannot fight themselves. The service refuses it; this is the
  -- backstop, because a self-PK is a host gifting their own score with their
  -- own audience and it would make every leaderboard meaningless.
  CONSTRAINT pk_not_self CHECK (home_user_id <> away_user_id),
  CONSTRAINT pk_rooms_differ CHECK (home_room_id <> away_room_id),
  -- A live battle must know its window; an ended one must know its outcome.
  CONSTRAINT pk_live_has_window CHECK (
    state <> 'live' OR (started_at IS NOT NULL AND ends_at IS NOT NULL)
  ),
  CONSTRAINT pk_ended_is_settled CHECK (state <> 'ended' OR settled_at IS NOT NULL),
  CONSTRAINT pk_winner_is_a_side CHECK (
    winner_user_id IS NULL
    OR winner_user_id = home_user_id
    OR winner_user_id = away_user_id
  )
);

CREATE TRIGGER pk_battles_updated_at BEFORE UPDATE ON pk_battles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One battle per host at a time, enforced by the database rather than by
-- checking first. Two invitations accepted in the same second would otherwise
-- both succeed, and a host would be scoring for two bars at once.
CREATE UNIQUE INDEX pk_one_live_per_home ON pk_battles (home_user_id)
  WHERE state IN ('pending', 'live');
CREATE UNIQUE INDEX pk_one_live_per_away ON pk_battles (away_user_id)
  WHERE state IN ('pending', 'live');

-- The settlement sweep's query: everything live whose window has closed.
CREATE INDEX pk_due_idx ON pk_battles (ends_at) WHERE state = 'live';
-- A room asking "am I in a battle?" on join.
CREATE INDEX pk_rooms_idx ON pk_battles (home_room_id, away_room_id) WHERE state IN ('pending', 'live');
CREATE INDEX pk_history_idx ON pk_battles (home_user_id, settled_at DESC) WHERE state = 'ended';

COMMENT ON TABLE pk_battles IS
  'A scoreboard over gift_sends. Moves no money, settles no wager, and must '
  'never gain a prize column — see the header of migration 028.';

-- ---------------------------------------------------------------------------
-- Team mode
-- ---------------------------------------------------------------------------

-- Who is on which side, for team battles. Empty for 1v1, where the two hosts
-- ARE the two sides.
CREATE TABLE pk_battle_members (
  battle_id  uuid NOT NULL REFERENCES pk_battles(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id),
  side       text NOT NULL CHECK (side IN ('home', 'away')),
  joined_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (battle_id, user_id)
);

CREATE INDEX pk_members_side_idx ON pk_battle_members (battle_id, side);

-- ---------------------------------------------------------------------------
-- Streaks
-- ---------------------------------------------------------------------------

-- A host's record, updated once per settlement.
--
-- Not derived, unlike the score, and the distinction is worth stating: a score
-- summarises rows that still exist, where a streak summarises a SEQUENCE of
-- outcomes and recomputing it means walking a host's entire battle history on
-- every read. It is also a statistic rather than a figure anybody is paid on,
-- so a drift here costs a badge, not money.
CREATE TABLE pk_host_stats (
  user_id      uuid PRIMARY KEY REFERENCES users(id),
  -- Consecutive wins. Reset to 0 by a loss or a draw.
  streak       integer NOT NULL DEFAULT 0 CHECK (streak >= 0),
  best_streak  integer NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  wins         integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses       integer NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws        integer NOT NULL DEFAULT 0 CHECK (draws >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER pk_host_stats_updated_at BEFORE UPDATE ON pk_host_stats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Invitations and the random queue
-- ---------------------------------------------------------------------------

-- A host asking another host for a battle.
--
-- Separate from `pk_battles` because most invitations never become one, and a
-- table of pending battles that mostly are not battles makes every query about
-- live ones carry a state filter it should not need.
CREATE TABLE pk_invites (
  id           uuid PRIMARY KEY,
  from_user_id uuid NOT NULL REFERENCES users(id),
  from_room_id uuid NOT NULL REFERENCES rooms(id),
  to_user_id   uuid NOT NULL REFERENCES users(id),
  state        text NOT NULL DEFAULT 'pending'
                 CHECK (state IN ('pending', 'accepted', 'declined', 'expired')),
  -- Short. An invitation to go on camera right now is worthless five minutes
  -- later, and a stale list of them is a list nobody reads.
  expires_at   timestamptz NOT NULL,
  responded_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_invite_not_self CHECK (from_user_id <> to_user_id)
);

-- One outstanding invitation per pair, in one direction. Spamming the same
-- host with twenty invitations is the first thing this would be used for.
CREATE UNIQUE INDEX pk_invite_one_pending ON pk_invites (from_user_id, to_user_id)
  WHERE state = 'pending';
CREATE INDEX pk_invite_inbox_idx ON pk_invites (to_user_id, created_at DESC) WHERE state = 'pending';
CREATE INDEX pk_invite_expiry_idx ON pk_invites (expires_at) WHERE state = 'pending';

-- Hosts waiting to be matched with anybody.
--
-- The "Random PK" the references advertise. One row per waiting host, removed
-- when matched or when they give up.
CREATE TABLE pk_queue (
  user_id    uuid PRIMARY KEY REFERENCES users(id),
  room_id    uuid NOT NULL REFERENCES rooms(id),
  -- Matched oldest-first, so waiting is rewarded rather than randomised again.
  joined_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pk_queue_order_idx ON pk_queue (joined_at);

-- ---------------------------------------------------------------------------
-- Config
-- ---------------------------------------------------------------------------

INSERT INTO app_config (key, value, description) VALUES (
  'pk',
  '{
     "durationSeconds": 300,
     "minDurationSeconds": 60,
     "maxDurationSeconds": 900,
     "inviteTtlSeconds": 60,
     "queueTtlSeconds": 180,
     "maxStreakMultiplier": 5,
     "enabled": true
   }'::jsonb,
  'PK battle dials. durationSeconds is the default window; a host may choose '
  'between min and max. inviteTtlSeconds expires an unanswered invitation and '
  'queueTtlSeconds gives up on matchmaking. maxStreakMultiplier caps the '
  'DISPLAYED win multiplier — it never touches points or the ledger. '
  'enabled=false is the kill switch (day-1 non-negotiable #5).'
);
