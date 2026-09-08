-- ===========================================================================
-- 011_otp_widget — MSG91 widget credentials, served to the client at runtime
--
-- The widget's `tokenAuth` has to reach the app, and anything that reaches the
-- app is PUBLIC: an APK unzips in seconds and the JS bundle is right there.
-- So the goal is not secrecy — it is blast radius and rotation speed.
--
-- Serving it from app_config rather than baking it into the bundle buys three
-- things that matter more than the illusion of hiding it:
--
--   · rotate without an app release, and without waiting for users to update
--   · revoke in seconds if the SMS balance starts moving
--   · a kill switch — stop serving it and signup falls back to our own OTP
--     path, which stays in place behind the provider interface
--
-- The account AUTHKEY is deliberately NOT here. That one verifies tokens
-- server-side, is the difference between a leak costing money and a leak
-- costing accounts, and lives in the environment where it can never be served.
--
-- Values are empty on purpose. They are pasted in from the MSG91 panel per
-- environment; a real credential committed to git is a credential to rotate.
-- ===========================================================================

INSERT INTO app_config (key, value, description) VALUES

  ('otp_widget_enabled', 'false'::jsonb,
   'Master switch for MSG91 widget sign-in. Off falls back to our own OTP flow, which stays implemented — an outage should degrade signup, not stop it.'),

  ('otp_widget_id', '""'::jsonb,
   'MSG91 widget id. Public, and shipped to the client.'),

  ('otp_widget_token_auth', '""'::jsonb,
   'MSG91 widget auth token. PUBLIC by construction — it is read from an APK in seconds. Bound the damage in the MSG91 panel instead: restrict countries to IN, keep captcha on, and set the resend caps low. NEVER put the account authkey here.')

ON CONFLICT (key) DO NOTHING;
