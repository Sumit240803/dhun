-- ---------------------------------------------------------------------------
-- 037 · Phase 1, second slice: polls, daily tasks, fan levels, super
--       messages, VIP tiers
--
-- app-blueprint-v1 Phase 1: "polls in room", "daily tasks", "fan levels",
-- "super message", "VIP tiers". None of these moves money to a host: polls
-- and tasks are free, fan levels are a reading of gifts already paid, and
-- super messages and VIP spend GEMS, which pay nobody (CLAUDE.md invariant
-- #8). The payout ratio is untouched by everything in this file.
-- ---------------------------------------------------------------------------

-- ── Polls ───────────────────────────────────────────────────────────────────
--
-- A host (or a room admin) asks the room a question; the room answers, once
-- each, for free. One open poll per room at a time. A poll ends when its
-- clock runs out or the host closes it; votes after either are refused.
-- Nothing here is paid and nothing is won — a poll that cost coins to vote in
-- would be a wager on an outcome (hard rule #1).
CREATE TABLE room_polls (
  id          uuid PRIMARY KEY,
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES users(id),
  question    text NOT NULL CHECK (length(question) BETWEEN 1 AND 120),
  -- 2 to 4 short strings. Tallies are COUNTED from the votes, never stored.
  options     jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array'
                                    AND jsonb_array_length(options) BETWEEN 2 AND 4),
  ends_at     timestamptz NOT NULL,
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX room_polls_one_open ON room_polls (room_id) WHERE closed_at IS NULL;
CREATE INDEX room_polls_room_idx ON room_polls (room_id, created_at DESC);

CREATE TABLE room_poll_votes (
  poll_id       uuid NOT NULL REFERENCES room_polls(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  option_index  smallint NOT NULL CHECK (option_index BETWEEN 0 AND 3),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

INSERT INTO app_config (key, value, description) VALUES
  ('polls',
   '{"durationsSeconds": [60, 120, 300], "defaultSeconds": 120}'::jsonb,
   'Room polls: the lengths a host may pick and the default. Votes are free and one per person.')
ON CONFLICT (key) DO NOTHING;

-- ── Daily tasks ─────────────────────────────────────────────────────────────
--
-- A short list of things to do today for free coins. Progress is DERIVED
-- from what already happened (gifts sent, lines chatted, follows, watch
-- intervals), never counted into a column — except `share`, which the server
-- cannot see and the app reports once a day.
CREATE TABLE task_events (
  user_id     uuid NOT NULL REFERENCES users(id),
  kind        text NOT NULL CHECK (kind IN ('share')),
  day_ist     date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, day_ist)
);

-- A task claim is a reward claim like any other: once-only by its key.
ALTER TABLE reward_claims DROP CONSTRAINT reward_claims_kind_check;
ALTER TABLE reward_claims ADD CONSTRAINT reward_claims_kind_check
  CHECK (kind IN ('signup', 'checkin', 'watch', 'referral', 'new_user', 'task'));

INSERT INTO app_config (key, value, description) VALUES
  ('daily_tasks',
   '{"tasks": [
      {"id": "watch10", "kind": "watch_minutes", "target": 10, "coins": 40},
      {"id": "chat5",   "kind": "chat",          "target": 5,  "coins": 20},
      {"id": "gift1",   "kind": "gifts",         "target": 1,  "coins": 30},
      {"id": "follow1", "kind": "follows",       "target": 1,  "coins": 20},
      {"id": "share1",  "kind": "share",         "target": 1,  "coins": 20}
    ]}'::jsonb,
   'Daily tasks (Phase 1). kind: watch_minutes | chat | gifts | follows | share. Progress is derived from the day''s activity; coins are ordinary free coins, once per task per IST day. Set a task''s coins to 0 to hide it.')
ON CONFLICT (key) DO NOTHING;

-- Today's chat lines per user, and follows per user per day.
CREATE INDEX room_messages_user_time_idx ON room_messages (user_id, created_at DESC);
CREATE INDEX follows_follower_time_idx ON follows (follower_user_id, created_at DESC);

-- ── Fan levels ──────────────────────────────────────────────────────────────
--
-- How much one person has gifted one host, all time, read into a level. A
-- SUM over this index, never a counter; cached for a minute by whoever asks.
CREATE INDEX gift_sends_sender_recipient_idx
  ON gift_sends (sender_user_id, recipient_user_id) INCLUDE (coins);

INSERT INTO app_config (key, value, description) VALUES
  ('fan_levels',
   '{"thresholds": [1, 2000, 10000, 50000, 200000, 1000000, 5000000]}'::jsonb,
   'Fan level thresholds in coins gifted to ONE host, all time. Level = number of thresholds reached (0 = never gifted). Display only; nothing is paid on a level.')
ON CONFLICT (key) DO NOTHING;

-- ── Super messages ──────────────────────────────────────────────────────────
--
-- A paid, highlighted, pinned line in one room. Priced in GEMS from the
-- `super_message` cosmetic row, which 016 switched off until now. Pays the
-- host nothing — it is a cosmetic for a sentence — so it rides the
-- `cosmetic_purchase` transaction type and legs, and the row below is written
-- inside that transaction exactly as cosmetic_purchases is.
CREATE TABLE super_messages (
  txn_id      uuid PRIMARY KEY REFERENCES ledger_txns(id),
  room_id     uuid NOT NULL REFERENCES rooms(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 200),
  gems        bigint NOT NULL CHECK (gems > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX super_messages_room_idx ON super_messages (room_id, created_at DESC);

CREATE OR REPLACE FUNCTION super_messages_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'super_messages is append-only (attempted % on %)', TG_OP, OLD.txn_id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_super_messages_immutable
  BEFORE UPDATE OR DELETE ON super_messages
  FOR EACH ROW EXECUTE FUNCTION super_messages_immutable();

UPDATE cosmetics SET is_active = true WHERE id = 'super_message';

INSERT INTO app_config (key, value, description) VALUES
  ('super_message',
   '{"pinSeconds": 30, "maxLength": 120}'::jsonb,
   'Super message: how long it stays pinned over the chat, and the longest text allowed. The gem price is the super_message row in cosmetics.')
ON CONFLICT (key) DO NOTHING;

-- ── VIP ─────────────────────────────────────────────────────────────────────
--
-- Four monthly tiers, priced in gems, each a BUNDLE: a badge beside the name
-- everywhere a look is drawn, plus cosmetics included for the same 30 days.
-- Owning a tier is a `user_cosmetics` row of kind `vip`, exactly like a
-- frame, so the same expiry rules and the same read path apply. Included
-- items are granted with source = 'vip' so a renewal can extend them and a
-- refund (if that policy is ever adopted) can find them.
--
-- The ledger side is `vip_purchase` (seeded in 002, inactive until now), with
-- the cosmetic legs: gems to the float, deferred revenue recognised. Zero
-- points. Renewal is simply another purchase (ledger-decisions § C12).
UPDATE ledger_txn_types SET is_active = true WHERE code = 'vip_purchase';
UPDATE cosmetics SET is_active = true WHERE kind = 'vip';

ALTER TABLE user_cosmetics DROP CONSTRAINT user_cosmetics_source_check;
ALTER TABLE user_cosmetics ADD CONSTRAINT user_cosmetics_source_check
  CHECK (source IN ('purchase', 'level', 'vip'));

INSERT INTO app_config (key, value, description) VALUES
  ('vip_tiers',
   '{"tiers": [
      {"id": "vip_silver",   "badge": "silver",   "includes": ["nickname_color"],
       "perks": ["badge", "name_color"]},
      {"id": "vip_gold",     "badge": "gold",     "includes": ["nickname_color", "chat_bubble", "entry_basic"],
       "perks": ["badge", "name_color", "bubble", "entry"]},
      {"id": "vip_platinum", "badge": "platinum", "includes": ["nickname_color", "chat_bubble", "entry_basic", "frame_basic"],
       "perks": ["badge", "name_color", "bubble", "entry", "frame", "stealth"]},
      {"id": "vip_diamond",  "badge": "diamond",  "includes": ["nickname_color", "chat_bubble", "entry_premium", "frame_basic"],
       "perks": ["badge", "name_color", "bubble", "entry", "frame", "stealth", "global_badge", "priority_mic"]}
    ]}'::jsonb,
   'VIP tiers (economy-design-v1 § cosmetics). Each tier is a cosmetics row of kind vip (price, 30 days) plus the items bundled for the same period. perks is what the app lists; stealth, global_badge and priority_mic are listed as perks and enforced in later work.')
ON CONFLICT (key) DO NOTHING;
