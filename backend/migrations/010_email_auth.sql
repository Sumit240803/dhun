-- ===========================================================================
-- 010_email_auth — sign in with an email address
--
-- Phone stays the primary path: it is what India signs up with, and it is what
-- the payout identity is eventually tied to. Email exists because the login
-- screen offers it, because DLT registration is still outstanding, and because
-- an account with no recovery channel is one lost SIM away from a support
-- ticket nobody can resolve.
--
-- VERIFICATION IS DEFERRABLE BY DESIGN. A new account works immediately with an
-- unverified address; confirming it is a separate step that can happen later.
-- Blocking the app behind an inbox round trip is where signup funnels go to die.
-- What verification gates is MONEY, not access — see the constraint below.
-- ===========================================================================

ALTER TABLE users
  -- Stored exactly as typed for display, matched case-insensitively via the
  -- index below. Lower-casing on write loses "Sumit@" vs "sumit@" in a
  -- greeting, and gains nothing the index does not already give.
  ADD COLUMN email             text,
  ADD COLUMN email_verified_at timestamptz,
  -- scrypt, with its parameters and salt inline. NULL for a phone-only account:
  -- there is no password to check, and a column of empty strings invites code
  -- that treats "" as a valid hash.
  ADD COLUMN password_hash     text;

-- Case-insensitive uniqueness. Without it, Sumit@x.com and sumit@x.com are two
-- accounts, and the second person to sign up is convinced they were hacked.
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email))
  WHERE email IS NOT NULL;


-- ---------------------------------------------------------------------------
-- The active-user constraint, widened for email
--
-- 009 said an active user must have a verified PHONE, because at the time that
-- was the only way to become active. An email account has no phone, so that
-- constraint would forbid it existing at all.
--
-- The rule it was protecting was never about phones: it was "an active user is
-- reachable and identified". So it now requires a CONTACT of either kind.
--
-- Verification is deliberately NOT part of this. Money is gated in the
-- middleware instead (requireRegistered), which demands a verified contact plus
-- an adult date of birth — because that is where the rule actually needs to
-- hold, and putting it here would make an unverified account impossible to
-- create at all.
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT users_active_has_verified_phone;

ALTER TABLE users ADD CONSTRAINT users_active_has_contact
  CHECK (status <> 'active' OR phone_e164 IS NOT NULL OR email IS NOT NULL);

-- A password only ever belongs to an account with an email to log in with.
ALTER TABLE users ADD CONSTRAINT users_password_needs_email
  CHECK (password_hash IS NULL OR email IS NOT NULL);


-- ---------------------------------------------------------------------------
-- email_verifications
--
-- Separate from otp_challenges rather than generalising it. That table is
-- shaped around a phone, a channel and TRAI's constraints; merging the two
-- would mean a column that is null half the time and a check that is really two
-- checks. Two small tables read better than one clever one.
--
-- Used for BOTH confirming an address and resetting a password. Same delivery,
-- same expiry, same attempt counting — the `purpose` column keeps a code minted
-- for one from being spent on the other, which is the only difference that
-- matters and the one that would be a real vulnerability if missed.
-- ---------------------------------------------------------------------------
CREATE TABLE email_verifications (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  -- Snapshotted, not joined. A code sent to an old address must not confirm a
  -- new one after the user changes it mid-flight.
  email         text NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('verify','reset')),
  -- HMAC of the code, never the code. A database dump must not hand over a
  -- working password reset for every pending request.
  code_hash     text NOT NULL,
  attempts      smallint NOT NULL DEFAULT 0,
  max_attempts  smallint NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The lookup on submit: the newest live challenge for this user and purpose.
CREATE INDEX email_verifications_live_idx
  ON email_verifications (user_id, purpose, created_at DESC)
  WHERE consumed_at IS NULL;

-- Rate limiting reads this: how many have been sent to this address lately.
CREATE INDEX email_verifications_recent_idx ON email_verifications (email, created_at DESC);
