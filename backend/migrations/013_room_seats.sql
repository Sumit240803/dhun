-- ---------------------------------------------------------------------------
-- 013 · Seats, bans and sessions — the durable half of a live room
--
-- LiveKit owns the media and the moment-to-moment truth of who is connected.
-- It is deliberately NOT mirrored here: a presence table would drift from the
-- media server within seconds of the first dropped connection, and the two
-- would disagree in front of a user.
--
-- What lives in Postgres is what LiveKit cannot answer:
--
--   · who holds mic seat 3, decided by a transaction rather than a race;
--   · who is barred from coming back after a kick;
--   · how long a host was actually live, which is a payout input.
--
-- The dividing line: if losing it on a media-server restart would be wrong,
-- it belongs here. Everything else is asked of LiveKit.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- room_seats · who is on the mic
--
-- A seat is the ONLY thing that grants publish permission, and taking one is a
-- race between everyone who tapped at the same moment. The primary key is what
-- settles it — two people cannot hold seat 3, and the loser gets a clean
-- "seat taken" rather than an audio free-for-all.
-- ---------------------------------------------------------------------------
CREATE TABLE room_seats (
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  -- 0 is the host's seat in a party room. Bounded to the widest capacity the
  -- rooms table allows, so a bad index can never be written at all.
  seat_index  smallint NOT NULL CHECK (seat_index BETWEEN 0 AND 19),
  user_id     uuid NOT NULL REFERENCES users(id),

  -- Muted BY THE HOST, which is not the same as a user muting themselves.
  -- Self-mute is a client-side track state and LiveKit's business; this is a
  -- moderation action that must survive the user reconnecting to dodge it.
  muted       boolean NOT NULL DEFAULT false,
  taken_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (room_id, seat_index)
);

-- One seat per person per room. Without this, a double-tap or a retry puts the
-- same user on two seats and the seat map shows them twice.
CREATE UNIQUE INDEX room_seats_one_per_user_idx ON room_seats (room_id, user_id);

-- "Which room is this user speaking in", asked on every reconnect.
CREATE INDEX room_seats_user_idx ON room_seats (user_id);


-- ---------------------------------------------------------------------------
-- room_bans · kicked, and staying out
--
-- Removing a participant from LiveKit disconnects them and nothing more —
-- their SDK reconnects and they are back in the room seconds later. The kick
-- only means something if the join path refuses them, which is what this is.
--
-- Scoped to one room, and separate from the platform-wide ban in `users`.
-- A host throwing someone out of their room is not a platform judgement, and
-- conflating the two would hand every host the power to suspend an account.
-- ---------------------------------------------------------------------------
CREATE TABLE room_bans (
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  banned_by   uuid NOT NULL REFERENCES users(id),
  reason      text CHECK (reason IS NULL OR length(reason) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (room_id, user_id)
);


-- ---------------------------------------------------------------------------
-- room_sessions · how long the host was actually live
--
-- A separate table from `rooms.started_at/ended_at` for one reason: a host
-- disconnecting is not the room ending. A tunnel, a call, a dropped Wi-Fi —
-- the room stays open and the audience stays in it, but those minutes are not
-- host hours and must not be paid as if they were.
--
-- So `rooms` spans the whole broadcast and this table records each unbroken
-- stretch the host was actually connected. Host hours are the SUM over this,
-- never the difference on `rooms`, and the seeding guarantee (M8) is settled
-- from here.
-- ---------------------------------------------------------------------------
CREATE TABLE room_sessions (
  id           uuid PRIMARY KEY,
  room_id      uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  host_user_id uuid NOT NULL REFERENCES users(id),
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,

  CONSTRAINT room_sessions_ends_after_start
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- The payout query: every stretch a host was live in a period.
CREATE INDEX room_sessions_host_idx ON room_sessions (host_user_id, started_at DESC);

-- Finding the open stretch to close when the host disconnects. Partial, because
-- exactly one row per room is open at a time and the rest are history.
CREATE UNIQUE INDEX room_sessions_open_idx ON room_sessions (room_id)
  WHERE ended_at IS NULL;


-- ---------------------------------------------------------------------------
-- rooms · why it ended
--
-- Three very different things look identical in the feed once ended_at is set:
-- a host who chose to stop, a host whose connection died and never came back,
-- and a room a moderator killed. Only the last is an incident, and telling them
-- apart after the fact is impossible without recording it at the time.
-- ---------------------------------------------------------------------------
ALTER TABLE rooms
  ADD COLUMN ended_reason text
    CHECK (ended_reason IS NULL OR ended_reason IN ('host', 'timeout', 'moderation'));
