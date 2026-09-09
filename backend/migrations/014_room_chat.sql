-- ---------------------------------------------------------------------------
-- 014 · Room chat and the mic queue
--
-- The two things the realtime gateway carries that must outlive a socket.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- room_messages · what was said in a room
--
-- PERSISTED, even though chat is ephemeral to the people reading it. Three
-- reasons, and only the first is obvious:
--
--   1. Someone joining thirty seconds late sees an empty room and leaves. A
--      short backlog on join is the difference between a room that looks dead
--      and one that looks busy — which is the whole cold-start problem the
--      growth plan is about.
--   2. A report (M9) is worthless without the message it is reporting. "User X
--      said something abusive" with no text is not a case a moderator can act
--      on, and the reporter cannot be asked to screenshot it.
--   3. IT Rules 2021 require a grievance process that can actually examine what
--      happened.
--
-- Purged on a retention schedule by the workers process, like everything else
-- here — this table grows faster than any other in the system and none of it
-- is interesting after a fortnight.
-- ---------------------------------------------------------------------------
CREATE TABLE room_messages (
  -- uuidv7: time-ordered, so "the last 50 messages" is an index scan and the
  -- id itself carries the ordering a chat log needs.
  id          uuid PRIMARY KEY,
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),

  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),

  -- What the FILTER decided, kept beside the message rather than replacing it.
  -- A moderator reviewing an appeal needs to see what was actually typed, and
  -- storing only the cleaned version destroys the evidence for the decision.
  --   clean    — delivered as typed
  --   filtered — delivered with parts masked
  --   blocked  — never delivered; kept only for moderation
  verdict     text NOT NULL DEFAULT 'clean'
                CHECK (verdict IN ('clean', 'filtered', 'blocked')),

  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The backlog query: the most recent messages in one room. DESC because that is
-- the direction it is always read, and the index can then be scanned backwards
-- without a sort.
CREATE INDEX room_messages_room_idx ON room_messages (room_id, created_at DESC);

-- "Everything this user has said", which is the first thing a moderator opens
-- after a report and the shape a spam sweep needs.
CREATE INDEX room_messages_user_idx ON room_messages (user_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- room_mic_requests · asking for the microphone
--
-- A queue rather than a free-for-all. In a party room with eight seats and two
-- hundred listeners, an open grab is won by whoever taps fastest and the host
-- has no say in who speaks in their own room — which is the thing hosts
-- complain about first.
--
-- The row is the request. Approval happens by the host taking the ordinary
-- seat-assignment path, so there is exactly one way a seat is ever granted and
-- no second code path to keep in step with it.
-- ---------------------------------------------------------------------------
CREATE TABLE room_mic_requests (
  room_id      uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id),

  -- pending → granted | denied | cancelled. Terminal states are kept rather
  -- than deleted: a host repeatedly denying the same person is a moderation
  -- signal, and it is invisible if the evidence is thrown away.
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'granted', 'denied', 'cancelled')),

  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,

  PRIMARY KEY (room_id, user_id)
);

-- The host's queue: pending requests, oldest first. Partial, because resolved
-- rows are the overwhelming majority within an hour and are never in the queue.
CREATE INDEX room_mic_requests_pending_idx
  ON room_mic_requests (room_id, requested_at)
  WHERE status = 'pending';
