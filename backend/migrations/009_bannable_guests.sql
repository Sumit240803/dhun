-- ===========================================================================
-- 009_bannable_guests — a guest must be bannable
--
-- `users_registered_has_phone` exempted only 'guest' and 'deleted', so setting
-- a guest to 'banned' or 'suspended' violated it and the UPDATE failed. A guest
-- is precisely the account an abuser creates in seconds, and the only remedies
-- left were deleting the row — losing the audit trail a moderation decision
-- depends on — or leaving them running.
--
-- The constraint's real intent was never "registered users have phones". It was
-- "a user who can TRANSACT has a verified identity", because every downstream
-- money rule assumes one. Only 'active' can transact, so only 'active' needs to
-- satisfy it. Written that way, the enforcement statuses are exempt by
-- construction rather than by a list somebody has to remember to extend.
-- ===========================================================================

ALTER TABLE users DROP CONSTRAINT users_registered_has_phone;

ALTER TABLE users ADD CONSTRAINT users_active_has_verified_phone
  CHECK (status <> 'active' OR (phone_e164 IS NOT NULL AND phone_verified_at IS NOT NULL));
