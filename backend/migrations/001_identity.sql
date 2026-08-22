-- ============================================================================
-- 001 · Identity, devices, sessions, and scoped roles
--
-- Conventions used throughout (see docs/build-plan.md and CLAUDE.md):
--   · uuid v7 for API-exposed ids, generated app-side (time-ordered => no index
--     fragmentation). bigserial for high-volume internal rows.
--   · timestamptz everywhere, UTC in the DB. IST only at the presentation layer.
--   · Nothing is deleted. revoked_at / deleted_at / status columns instead.
--   · Lookup TABLE when a value carries metadata; CHECK constraint when it is
--     only a label. Never a Postgres enum — changing one is painful.
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- users
--
-- A guest is a real row with no phone. Signing up fills in the phone and flips
-- status in place, so events recorded before signup are never orphaned.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                 uuid PRIMARY KEY,
  phone_e164         text UNIQUE,
  phone_verified_at  timestamptz,
  status             text NOT NULL DEFAULT 'guest'
                       CHECK (status IN ('guest','active','suspended','banned','deleted')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  -- A registered user must have a verified phone. Enforced here rather than in
  -- code because every downstream money rule assumes a verified identity.
  -- 'deleted' is exempt alongside 'guest': a guest who never signed up can still
  -- be deleted, and phone numbers are cleared on erasure requests.
  CONSTRAINT users_registered_has_phone
    CHECK (status IN ('guest','deleted')
        OR (phone_e164 IS NOT NULL AND phone_verified_at IS NOT NULL))
);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_users_status ON users (status) WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------------
-- user_profiles · display data, separated so the hot users table stays narrow
-- ---------------------------------------------------------------------------
CREATE TABLE user_profiles (
  user_id       uuid PRIMARY KEY REFERENCES users(id),
  display_name  text,
  avatar_url    text,
  bio           text,
  gender        text CHECK (gender IN ('male','female','other','undisclosed')),
  date_of_birth date,          -- 18+ gate; PAN DOB is the authority for hosts
  country       text NOT NULL DEFAULT 'IN',
  locale        text NOT NULL DEFAULT 'hi-IN',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- user_devices
--
-- Two of the six fraud signals in data-and-launch-plan-v1 key off device
-- identity ("same device ID, 5+ accounts"), which is why device_id is indexed
-- on its own and not only under user_id.
-- ---------------------------------------------------------------------------
CREATE TABLE user_devices (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  device_id     text NOT NULL,              -- stable, client-generated
  platform      text NOT NULL CHECK (platform IN ('android','ios','web')),
  app_version   text,
  push_token    text,
  fingerprint   jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, device_id)
);

CREATE INDEX idx_user_devices_device ON user_devices (device_id);
CREATE INDEX idx_user_devices_push ON user_devices (user_id) WHERE push_token IS NOT NULL;


-- ---------------------------------------------------------------------------
-- otp_challenges
--
-- Kept in Postgres rather than Redis: low volume, and it gives an audit trail
-- plus rate limiting that survives a restart. Codes are hashed — a leaked
-- database read must not hand over live OTPs.
-- ---------------------------------------------------------------------------
CREATE TABLE otp_challenges (
  id            uuid PRIMARY KEY,
  phone_e164    text NOT NULL,
  code_hash     text NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('whatsapp','sms')),
  attempts      smallint NOT NULL DEFAULT 0,
  max_attempts  smallint NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Serves both "find the live challenge" and per-phone send-rate limiting.
CREATE INDEX idx_otp_phone_created ON otp_challenges (phone_e164, created_at DESC);


-- ---------------------------------------------------------------------------
-- refresh_tokens · rotating, hashed, chained
--
-- replaced_by makes the rotation chain explicit: if an already-rotated token is
-- presented, that is a replay and the whole chain should be revoked.
-- ---------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  text NOT NULL UNIQUE,
  device_id   text,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id)
);

CREATE INDEX idx_refresh_active ON refresh_tokens (user_id) WHERE revoked_at IS NULL;


-- ---------------------------------------------------------------------------
-- roles + role_assignments
--
-- app-blueprint-v1 is explicit: NO users.role column. One person is at once a
-- viewer, a host, a room admin in three rooms, and possibly an agency manager.
-- Roles carry metadata (scope, internal flag) so this is a lookup TABLE.
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  code        text PRIMARY KEY,
  scope_type  text NOT NULL CHECK (scope_type IN ('global','room','agency')),
  is_internal boolean NOT NULL DEFAULT false,   -- admin-panel roles
  description text NOT NULL
);

INSERT INTO roles (code, scope_type, is_internal, description) VALUES
  -- in-app
  ('host',              'global', false, 'Goes live, earns points from gifts'),
  ('agency_owner',      'agency', false, 'Owns a talent agency, earns commission'),
  ('agency_manager',    'agency', false, 'Manages hosts inside an agency'),
  ('sub_agent',         'agency', false, 'Brings hosts under an agency; paid BY the agency, never by the platform'),
  ('coin_reseller',     'global', false, 'Buys coins in bulk with own money, resells'),
  ('room_admin',        'room',   false, 'Moderates one room; granted by that room''s host'),
  -- internal (admin panel)
  ('super_admin',       'global', true,  'Full access'),
  ('ops_manager',       'global', true,  'Day-to-day operations'),
  ('content_moderator', 'global', true,  'Reviews streams and reports'),
  ('ts_lead',           'global', true,  'Trust and safety lead; confirms L1/L2 actions'),
  ('finance_operator',  'global', true,  'Prepares payout batches (maker)'),
  ('finance_approver',  'global', true,  'Approves payout batches (checker)'),
  ('risk_analyst',      'global', true,  'Fraud signals and risk scoring'),
  ('support_agent',     'global', true,  'User support'),
  ('agency_relations',  'global', true,  'Manages agency relationships'),
  ('growth',            'global', true,  'Campaigns and acquisition'),
  ('data_analyst',      'global', true,  'Read-only analytics'),
  ('engineer',          'global', true,  'Engineering access'),
  ('grievance_officer', 'global', true,  'IT Rules 2021 mandated, India-resident'),
  ('auditor',           'global', true,  'Read-only, including ledger');

CREATE TABLE role_assignments (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  role_code   text NOT NULL REFERENCES roles(code),
  scope_type  text NOT NULL CHECK (scope_type IN ('global','room','agency')),
  scope_id    uuid,                               -- NULL for global scope
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  uuid REFERENCES users(id),
  revoked_at  timestamptz,                        -- revoke = set this, never DELETE
  reason      text,

  CONSTRAINT role_scope_id_matches_type
    CHECK ((scope_type = 'global' AND scope_id IS NULL)
        OR (scope_type <> 'global' AND scope_id IS NOT NULL))
);

-- One active assignment of a role per scope. Revoked rows are excluded, so the
-- same role can be granted again later without tripping the constraint.
CREATE UNIQUE INDEX uq_role_assignment_active
  ON role_assignments (user_id, role_code, scope_type, scope_id)
  NULLS NOT DISTINCT
  WHERE revoked_at IS NULL;

-- The permission check runs on every authenticated request: keep it index-only.
CREATE INDEX idx_role_assignments_lookup
  ON role_assignments (user_id, scope_type, scope_id)
  WHERE revoked_at IS NULL;

-- "Who are the moderators?" / "who belongs to this agency?"
CREATE INDEX idx_role_assignments_by_role
  ON role_assignments (role_code, scope_id)
  WHERE revoked_at IS NULL;
