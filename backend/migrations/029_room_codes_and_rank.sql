-- ============================================================================
-- 029 · Room codes, and the hourly board
--
-- Two things the references put on the second line of every room, and the two
-- things our chrome had nothing to fill it with.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- rooms.public_id
--
-- The short number people quote: in chat, in a report, in WhatsApp when they
-- are trying to find each other. Exactly the pattern users, agencies and
-- agents already use, and for the reason migration 006 states — a value people
-- paste around should never be the string that identifies the row.
--
-- WHY NOT JUST MAKE THE PRIMARY KEY A NUMBER
--
-- Because a sequential primary key is a different object with different
-- properties, and all three of them are bad here:
--
--   · It is ENUMERABLE. Every room, every battle and every user becomes
--     walkable by anyone who can count, and every id in an URL turns into an
--     access-control question that a uuid never raises.
--   · It LEAKS VOLUME. Sign up twice a week, subtract, and you know our growth
--     rate. The same is true of rooms, gifts and transactions.
--   · It SERIALISES WRITES. `ledger_txns.id` is a uuidv7 generated on the app
--     server with no round trip. A sequence puts every money transaction behind
--     one lock, at the exact point in the system that must never queue.
--
-- A public_id gets the short number without any of that, which is why this
-- codebase already had three of them.
--
-- Six digits, starting at 100001. Rooms are created and ended constantly, so
-- this burns through numbers faster than users do — bigint, and the format is
-- not load-bearing anywhere. Seven digits in a couple of years is fine.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE room_public_id_seq START 100001;

ALTER TABLE rooms
  ADD COLUMN public_id bigint NOT NULL UNIQUE DEFAULT nextval('room_public_id_seq');

COMMENT ON COLUMN rooms.public_id IS
  'The short number shown in the room and quoted by users. Never a foreign key '
  '— rooms.id is what everything references.';

-- ---------------------------------------------------------------------------
-- room_hour_scores · the hourly board
--
-- Which rooms earned the most coins this hour, and where each one stands.
--
-- A ROLLUP, NOT A LIVE QUERY
--
-- The honest version of this is `SUM(coins) GROUP BY room_id` over gift_sends
-- for the current hour, ranked. That is correct and it is also a sort over
-- every gift in the last hour, run once per viewer per refresh, in the busiest
-- room on the platform. At 10K DAU that is the query that falls over first.
--
-- So a worker computes it once a minute and everybody reads the answer. The
-- cost is a rank up to 60 seconds stale, which is the right trade twice over:
-- it is cheap, and it means every viewer in a room sees the SAME position. Two
-- people in one room reading different ranks is worse than both reading one
-- that is a minute old.
--
-- Not derived from the ledger and not money — see ledger-decisions § D. A rank
-- summarises gifts that have already been paid; nothing here is payable.
-- ---------------------------------------------------------------------------
CREATE TABLE room_hour_scores (
  -- Truncated to the hour, UTC. The board resets on the hour, which is what
  -- makes "100+ with 18% to the next place" a thing worth chasing.
  hour_start   timestamptz NOT NULL,
  room_id      uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  host_user_id uuid NOT NULL REFERENCES users(id),

  coins        bigint NOT NULL DEFAULT 0 CHECK (coins >= 0),
  -- 1-based. Only the top slice is ranked; everything else is null and shows
  -- as "100+", exactly as the references do.
  rank         integer CHECK (rank IS NULL OR rank > 0),
  -- What the room directly above earned. Null for rank 1 and for the unranked.
  -- Stored rather than re-derived so the progress bar is one read.
  next_up_coins bigint CHECK (next_up_coins IS NULL OR next_up_coins >= 0),

  computed_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (hour_start, room_id)
);

-- The room's own lookup: "where do I stand right now".
CREATE INDEX room_hour_scores_room_idx ON room_hour_scores (room_id, hour_start DESC);
-- The board itself, and the purge.
CREATE INDEX room_hour_scores_board_idx ON room_hour_scores (hour_start, rank)
  WHERE rank IS NOT NULL;

COMMENT ON TABLE room_hour_scores IS
  'Hourly room board, recomputed by the room_hour_rollup worker every 60s. '
  'A cache of a SUM over gift_sends — never a source of truth, never payable.';

-- The rollup groups gifts by room inside an hour, and 015 indexed gift_sends by
-- room+sender and by recipient+time, neither of which serves that. Without this
-- the rollup is a sequential scan of the whole table every minute.
CREATE INDEX gift_sends_room_time_idx ON gift_sends (created_at, room_id) INCLUDE (coins);

INSERT INTO app_config (key, value, description) VALUES (
  'room_board',
  '{"rankedPositions": 100, "refreshSeconds": 60, "retentionHours": 48}'::jsonb,
  'The hourly room board. rankedPositions is how deep the board goes before a '
  'room shows as "100+". refreshSeconds is the rollup cadence, and the app '
  'polls at the same rate — faster would read a number that has not changed. '
  'retentionHours is how long finished hours are kept.'
);
