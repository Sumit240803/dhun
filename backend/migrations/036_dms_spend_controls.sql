-- ---------------------------------------------------------------------------
-- 036 · Private messages, spend controls, and a trending section
--
-- Phase 1 (app-blueprint-v1): "private DM", "spend limits, cooling-off".
-- ---------------------------------------------------------------------------

-- One direct thread per pair. The key is the two user ids sorted and joined,
-- so find-or-create is a single INSERT … ON CONFLICT and two people tapping
-- "Message" at the same moment land in the same thread.
ALTER TABLE message_threads ADD COLUMN direct_key text UNIQUE
  CHECK (direct_key IS NULL OR direct_key ~ '^[0-9a-f-]{36}:[0-9a-f-]{36}$');

-- ---------------------------------------------------------------------------
-- spend_controls · the user's own brakes (trust-and-safety-v1 § financial harm)
--
-- "User apni daily/monthly limit khud set kar sake. Self-exclusion 30 / 90 din
-- / permanent." The rules that make these real rather than decorative:
--
--   · A cap can be LOWERED at once and RAISED only after a delay — `pending`
--     holds the raise and when it applies ({ dailyCapCoins?, monthlyCapCoins?,
--     appliesAt }; a key present with null means "remove the cap"). A limit
--     you can lift the moment you want to spend is not a limit.
--   · An exclusion cannot be shortened or removed while it runs.
--   · Limits count coins SPENT ON GIFTS, which is where money leaves a user
--     for good; buying coins is already its own decision at the store.
-- ---------------------------------------------------------------------------
CREATE TABLE spend_controls (
  user_id                uuid PRIMARY KEY REFERENCES users(id),
  daily_cap_coins        bigint CHECK (daily_cap_coins IS NULL OR daily_cap_coins > 0),
  monthly_cap_coins      bigint CHECK (monthly_cap_coins IS NULL OR monthly_cap_coins > 0),
  pending                jsonb,
  excluded_until         timestamptz,
  excluded_permanently   boolean NOT NULL DEFAULT false,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER spend_controls_updated_at BEFORE UPDATE ON spend_controls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The cooling-off prompt: past this much spent on gifts in a calendar month,
-- the wallet says so and the app shows it once. ₹50,000 from the safety doc.
INSERT INTO app_config (key, value, description) VALUES
  ('safety',
   '{"coolingOffMonthlyPaise": 5000000, "capRaiseDelayHours": 24}'::jsonb,
   'Financial-harm brakes (trust-and-safety-v1): the monthly gift spend, in paise, after which the app shows a cooling-off prompt; and how long a raised self-set cap waits before it applies.')
ON CONFLICT (key) DO NOTHING;

-- What a user has spent today and this month, by sender.
CREATE INDEX gift_sends_sender_time_idx ON gift_sends (sender_user_id, created_at DESC) INCLUDE (coins);
