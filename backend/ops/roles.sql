-- ============================================================================
-- Database roles and grants — STAGING AND PRODUCTION
--
-- Referenced by migrations/002_ledger.sql. The append-only trigger on
-- ledger_entries catches application bugs in any role; this file is the SECOND
-- line of defence, and it catches what a trigger cannot: a console session, a
-- compromised connection string, or an injection that reaches raw SQL.
--
-- Run ONCE per environment, as a superuser, AFTER migrations. Not part of the
-- migration chain on purpose — roles are cluster-level, and the app role must
-- never be able to grant itself anything.
--
--   psql "$ADMIN_DATABASE_URL" -v app_role=dhun_app -f ops/roles.sql
--
-- Local development deliberately skips this: the dev database is owned by one
-- role and `npm run db:reset` needs DDL rights.
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. The application role. Owns no objects and can create none.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') THEN
    EXECUTE format('CREATE ROLE %I LOGIN', :'app_role');
  END IF;
END
$$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_role";

-- Baseline: full DML on everything, then take back what must never be possible.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- ---------------------------------------------------------------------------
-- 2. The ledger is append-only. Not by convention — by grant.
--
-- Money is corrected by posting a compensating transaction, never by editing
-- history. With UPDATE and DELETE revoked, no amount of application error or SQL
-- injection can rewrite a posted entry.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON ledger_entries FROM :"app_role";

-- Transactions are appended and then completed, so UPDATE stays — but a
-- transaction may never be erased.
REVOKE DELETE ON ledger_txns FROM :"app_role";

-- Reference data. Changing a gift price or a rate is an ADMIN action through a
-- reviewed path, never something an API request can do.
REVOKE INSERT, UPDATE, DELETE ON ledger_txn_types FROM :"app_role";
REVOKE INSERT, UPDATE, DELETE ON level_thresholds FROM :"app_role";
REVOKE DELETE ON coin_packs, gift_catalog, cosmetics, app_config FROM :"app_role";

-- Financial and safety history is evidence. Purchases and webhooks are kept for
-- chargeback disputes months later; roles carry the audit trail of who could do
-- what, and when it was taken away.
REVOKE DELETE ON purchases, payment_webhooks FROM :"app_role";
REVOKE DELETE ON role_assignments FROM :"app_role";
REVOKE UPDATE, DELETE ON outbox FROM :"app_role";
GRANT UPDATE (published_at, attempts, last_error) ON outbox TO :"app_role";

-- Migrations run as a different, higher-privileged role.
REVOKE ALL ON schema_migrations FROM :"app_role";
GRANT SELECT ON schema_migrations TO :"app_role";

-- ---------------------------------------------------------------------------
-- 3. Anything a later migration creates inherits the same baseline.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- ---------------------------------------------------------------------------
-- 4. A read-only role for the auditor, analysts and the reporting replica.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dhun_readonly') THEN
    CREATE ROLE dhun_readonly LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO dhun_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dhun_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dhun_readonly;

-- OTP codes and refresh tokens are hashed, but there is no reason for an analyst
-- to read either table at all.
REVOKE SELECT ON otp_challenges, refresh_tokens FROM dhun_readonly;

-- ---------------------------------------------------------------------------
-- 5. Verification — run after applying, expect zero rows.
-- ---------------------------------------------------------------------------
-- SELECT table_name, privilege_type
--   FROM information_schema.table_privileges
--  WHERE grantee = :'app_role'
--    AND table_name = 'ledger_entries'
--    AND privilege_type IN ('UPDATE', 'DELETE');
