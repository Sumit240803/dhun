-- ---------------------------------------------------------------------------
-- 033 · Kill switches
--
-- Day-1 non-negotiable #5, second half. The force-update gate has been live
-- since 007; the client flags have been there as long. What was missing is the
-- thing an incident actually needs: ONE switch per feature that stops it on
-- the server, in the ledger, and in the app together — and a record of who
-- threw it.
--
-- Before this, "pause gifting" meant two separate writes (the client flag and
-- `ledger_txn_types.is_active`) that could disagree, and both were SQL. The
-- rule in docs/development-pipeline.md is "kill switch first, fix second";
-- a kill switch that needs a psql session is not first.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- The switches themselves. One boolean per feature, keyed as
-- src/modules/config/features.ts lists them. A feature missing from this row
-- is ON — the row exists to turn things off deliberately, and a typo must
-- never be able to switch the product off.
--
-- The client-side flags these drive move OUT of `client_flags`, so there is
-- exactly one place a feature's state lives. What stays in `client_flags` is
-- the purely cosmetic (hindiEnabled, showWebRechargeLink, socialLoginEnabled).
-- ---------------------------------------------------------------------------
INSERT INTO app_config (key, value, description) VALUES
  ('features',
   jsonb_build_object(
     'gifting',     true,
     'purchases',   true,
     'conversion',  true,
     'cosmetics',   true,
     'goLive',      true,
     'videoRooms',  COALESCE((SELECT (value ->> 'videoRoomsEnabled')::boolean
                                FROM app_config WHERE key = 'client_flags'), false),
     'pk',          true,
     'rewards',     true,
     'agencyCoins', true
   ),
   'Kill switches, one per feature. OFF refuses the feature on the server, deactivates its ledger transaction types, and hides it in the app. Flip from /admin/switches, never by hand — the panel records who and why.')
ON CONFLICT (key) DO NOTHING;

UPDATE app_config
   SET value = value - 'giftingEnabled' - 'purchasesEnabled' - 'conversionEnabled' - 'videoRoomsEnabled'
 WHERE key = 'client_flags';


-- ---------------------------------------------------------------------------
-- config_changes · who changed what, and why
--
-- Every write the switches page makes lands here, with the value before and
-- after. Append-only by trigger, the same rule as enforcement_actions: a
-- record of why gifting was off for forty minutes on a Saturday night is the
-- record somebody will want on Monday.
-- ---------------------------------------------------------------------------
CREATE TABLE config_changes (
  id             uuid PRIMARY KEY,
  -- 'features.gifting', 'min_supported_app_version', …
  key            text NOT NULL CHECK (length(key) BETWEEN 1 AND 80),
  old_value      jsonb,
  new_value      jsonb NOT NULL,
  reason         text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  actor_user_id  uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX config_changes_recent_idx ON config_changes (created_at DESC);

CREATE OR REPLACE FUNCTION config_changes_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'config_changes is append-only (attempted % on %)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_config_changes_immutable
  BEFORE UPDATE OR DELETE ON config_changes
  FOR EACH ROW EXECUTE FUNCTION config_changes_immutable();
