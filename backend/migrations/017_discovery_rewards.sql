-- ---------------------------------------------------------------------------
-- 017 · Discovery and daily hooks
--
-- Free coins (welcome, check-in, watching, referral), the followed-host-is-live
-- push, people search, and the cold-start dials from growth-plan-v1.
--
-- Decisions: backend/docs/ledger-decisions.md § C5b, C5c.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- The dials
--
-- Free coins cost real money — the budget is 8% of paid revenue — and the
-- economy doc's first lever when that is breached is cutting these amounts. So
-- every one is config, not code.
-- ---------------------------------------------------------------------------
INSERT INTO app_config (key, value, description) VALUES
  ('free_coins',
   '{"signup": 500,
     "checkinLadder": [20, 30, 40, 60, 80, 100, 150],
     "watch": {"coins": 30, "minutes": 5, "dailyCap": 10},
     "referral": {"coins": 2000, "minPurchasePaise": 9900, "attachWindowDays": 7}}'::jsonb,
   'Free coin amounts and caps (economy-design-v1 § 6). The ≤8% budget lever: cut watch first, then referral.'),

  -- growth-plan-v1, "Cold start — product se solve karo". Every field can be
  -- switched off on its own once the app has enough rooms not to need it.
  ('cold_start',
   '{"maxFeedRooms": 4,
     "hideViewerCounts": true,
     "peakStartIst": "20:00",
     "peakEndIst": "23:00",
     "dropNewUsersIntoRoom": true}'::jsonb,
   'Cold-start dials: show fewer, fuller rooms; hide small viewer counts; name the peak hours; put a new user straight into the fullest room. Set maxFeedRooms to null to lift the cap.'),

  ('push',
   '{"liveDailyCapPerUser": 5, "liveCooldownMinutesPerHost": 120}'::jsonb,
   'Followed-host-is-live notifications: at most this many a day per person, and one per host per cooldown — a host restarting a room must not buzz every follower each time.')
ON CONFLICT (key) DO NOTHING;


-- ---------------------------------------------------------------------------
-- reward_claims · one row per free coin credit
--
-- Written inside the ledger transaction. `claim_key` is the ledger idempotency
-- key too, so a claim that exists here is a credit that exists there, and a
-- second claim of the same thing cannot pass either unique index.
-- ---------------------------------------------------------------------------
CREATE TABLE reward_claims (
  claim_key    text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  kind         text NOT NULL CHECK (kind IN ('signup', 'checkin', 'watch', 'referral')),
  coins        bigint NOT NULL CHECK (coins > 0),
  -- The IST calendar day the claim counts against. Caps are per day in India,
  -- not per UTC day, which would reset at 5:30 in the morning.
  day_ist      date NOT NULL,
  -- Check-in only: which day of the 7-day ladder this was.
  streak_day   smallint CHECK (streak_day BETWEEN 1 AND 7),
  txn_id       uuid NOT NULL UNIQUE REFERENCES ledger_txns(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reward_claims_user_day_idx ON reward_claims (user_id, kind, day_ist);

CREATE OR REPLACE FUNCTION reward_claims_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reward_claims is append-only (attempted % on %)', TG_OP, OLD.claim_key;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reward_claims_immutable
  BEFORE UPDATE OR DELETE ON reward_claims
  FOR EACH ROW EXECUTE FUNCTION reward_claims_immutable();


-- ---------------------------------------------------------------------------
-- referrals · who brought whom
-- ---------------------------------------------------------------------------
CREATE TABLE referrals (
  referred_user_id  uuid PRIMARY KEY REFERENCES users(id),
  referrer_user_id  uuid NOT NULL REFERENCES users(id),
  attached_at       timestamptz NOT NULL DEFAULT now(),
  -- Set when the referrer is paid. Null means the friend has not yet made a
  -- qualifying purchase.
  rewarded_at       timestamptz,
  CONSTRAINT referrals_not_self CHECK (referred_user_id <> referrer_user_id)
);

CREATE INDEX referrals_referrer_idx ON referrals (referrer_user_id);


-- ---------------------------------------------------------------------------
-- live_notifications · who was told a host went live, and when
--
-- Inserted BEFORE the push is sent. A crash between the two loses one
-- notification; the other order would send it twice on every retry of the
-- outbox batch, and a phone buzzing twice for the same room reads as spam.
-- ---------------------------------------------------------------------------
CREATE TABLE live_notifications (
  follower_user_id  uuid NOT NULL REFERENCES users(id),
  room_id           uuid NOT NULL REFERENCES rooms(id),
  host_user_id      uuid NOT NULL REFERENCES users(id),
  sent_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, room_id)
);

CREATE INDEX live_notifications_cooldown_idx
  ON live_notifications (follower_user_id, host_user_id, sent_at DESC);
CREATE INDEX live_notifications_daily_idx ON live_notifications (follower_user_id, sent_at DESC);


-- ---------------------------------------------------------------------------
-- Search
--
-- Prefix match on the display name, case-insensitive. text_pattern_ops is what
-- lets `lower(display_name) LIKE 'pri%'` use the index at all; a plain btree
-- cannot serve LIKE under a non-C collation.
-- ---------------------------------------------------------------------------
CREATE INDEX user_profiles_name_prefix_idx
  ON user_profiles (lower(display_name) text_pattern_ops);
