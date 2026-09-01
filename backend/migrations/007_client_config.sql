-- ===========================================================================
-- 007_client_config — remote flags and the force-update gate
--
-- No new tables. `app_config` already exists, is cached, and is exactly the
-- right shape: a key, a jsonb value, and a description that says what it is
-- for. Adding a second config table would mean two places to look and two
-- caches to invalidate.
--
-- This closes day-1 non-negotiable #5 — "force-update + remote kill switch per
-- major feature". The CLIENT half was already written: `applyRemoteFlags()`
-- has been sitting in mobile/src/config/flags.ts since the foundation, with
-- nothing to call it. Until now there was no way to turn gifting off, hide a
-- screen during store review, or require an update — each of which is needed
-- BEFORE a public build, not after.
-- ===========================================================================

INSERT INTO app_config (key, value, description) VALUES

  -- Kill switches, shipped to every client on launch and on resume.
  --
  -- These are the NON-money switches. The money layer has its own, stronger
  -- one: `ledger_txn_types.is_active` stops a flow inside the transaction
  -- itself, so a client that ignores a flag still cannot move coins.
  ('client_flags',
   '{"giftingEnabled": true,
     "purchasesEnabled": true,
     "showWebRechargeLink": false,
     "conversionEnabled": true,
     "videoRoomsEnabled": false,
     "hindiEnabled": true,
     "socialLoginEnabled": true}'::jsonb,
   'Remote feature flags merged over the client defaults. Unknown keys are ignored by older clients, so adding one never breaks a shipped build.'),

  -- Below this, the app refuses to run and sends the user to the store.
  --
  -- Reserved for a security fix or a broken money path — a force-update is the
  -- bluntest instrument there is, and using it for a feature launch trains
  -- users to distrust it.
  ('min_supported_app_version', '"1.0.0"'::jsonb,
   'Hard floor. A client below this version is blocked with an update prompt it cannot dismiss.'),

  -- Suggested, dismissible. This is the one to move for an ordinary release.
  ('latest_app_version', '"1.0.0"'::jsonb,
   'Newest published version. A client below this is offered an update it can decline.'),

  ('store_url_android', '"https://play.google.com/store/apps/details?id=com.dhunlive.dhun"'::jsonb,
   'Where the update prompt sends an Android user.')

ON CONFLICT (key) DO NOTHING;
