-- ---------------------------------------------------------------------------
-- 012 · Changing a phone number
--
-- The last hole in the recovery story. An account is reachable at exactly one
-- number, that number is what the payout identity eventually hangs off, and
-- until now there was no way to move it. A user who changes SIM — ordinary in
-- India, where numbers are cheap and churn is high — was one lost SIM away
-- from an account nobody could sign into and support could not fix.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- otp_challenges gains a purpose
--
-- The same distinction email_verifications was built with from the start, and
-- for the same reason: `purpose` is what stops a code minted for one flow being
-- spent on the other. Sign-in and phone-change are now two different things a
-- six-digit code can authorise, and without this column they would be one.
--
-- Defaulted to 'signin' so every existing row and every existing caller keeps
-- working unchanged.
-- ---------------------------------------------------------------------------
ALTER TABLE otp_challenges
  ADD COLUMN purpose text NOT NULL DEFAULT 'signin'
    CHECK (purpose IN ('signin', 'phone_change'));

-- The lookup is always (phone, purpose, most recent). The old index led with
-- phone alone, so a phone-change challenge and a sign-in challenge for the same
-- number would both be scanned to find either one.
DROP INDEX IF EXISTS idx_otp_phone_created;
CREATE INDEX idx_otp_phone_purpose_created
  ON otp_challenges (phone_e164, purpose, created_at DESC);


-- ---------------------------------------------------------------------------
-- phone_changes · the audit trail
--
-- A separate table rather than a column on users, because what matters is the
-- HISTORY. A number change is the single strongest account-takeover signal this
-- system has: it is what an attacker does immediately after getting in, and it
-- is what a support agent needs to see when someone writes in saying they have
-- been locked out.
--
-- Kept even after the account is deleted — the row carries no PII beyond the
-- numbers themselves, and a dispute about who owned a number is exactly the
-- case where deleting the evidence is the wrong answer.
-- ---------------------------------------------------------------------------
CREATE TABLE phone_changes (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  -- NULL when the account had no number to begin with, which is possible for
  -- an email-only account adding one.
  old_phone   text,
  new_phone   text NOT NULL,
  -- The device that made the change, for the same reason the sessions list
  -- exists: "which of my devices did this" is the first question asked.
  device_id   text,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_phone_changes_user ON phone_changes (user_id, changed_at DESC);

-- Answers "has this number moved between accounts recently", which is what a
-- fraud review actually asks. Recycled Indian numbers make this common enough
-- to be worth an index rather than a sequential scan.
CREATE INDEX idx_phone_changes_new_phone ON phone_changes (new_phone, changed_at DESC);
