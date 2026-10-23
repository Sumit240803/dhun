-- ---------------------------------------------------------------------------
-- 032 · New-user exclusive rewards
--
-- A short list of first actions — follow someone, send a first gift, say
-- something in a live room — each paying free coins once, inside a window that
-- opens when the ACCOUNT is created and never reopens.
--
-- The window is account-relative on purpose. A user who signs up and comes
-- back a month later gets nothing new: the clock started at signup, and a
-- window that restarted on return would be a reward for leaving.
--
-- The fourth row on the sheet, "check in today", is the existing daily
-- check-in and pays its existing ladder. It is not a second daily reward.
--
-- Decisions: backend/docs/ledger-decisions.md § C5d.
-- ---------------------------------------------------------------------------

ALTER TABLE reward_claims DROP CONSTRAINT reward_claims_kind_check;
ALTER TABLE reward_claims ADD CONSTRAINT reward_claims_kind_check
  CHECK (kind IN ('signup', 'checkin', 'watch', 'referral', 'new_user'));

INSERT INTO app_config (key, value, description) VALUES
  ('new_user_rewards',
   '{"windowDays": 7,
     "tasks": {"follow": 200, "gift": 600, "chat": 200}}'::jsonb,
   'New-user first-action rewards, in coins. The window runs from account creation and never restarts. Set a task to 0 to hide it; set windowDays to 0 to switch the sheet off.')
ON CONFLICT (key) DO NOTHING;
