-- ---------------------------------------------------------------------------
-- 040 · Rooms by language (build-plan M20 "nearby", decided 2026-11-03)
--
-- The blueprint's "nearby" is answered by LANGUAGE and nothing else. The
-- founder ruled out a state and ruled out GPS: a distance on a room card is
-- how a viewer finds where a host lives, and in India a region is mostly a
-- language anyway.
--
--   · user_profiles.languages — what a person says they speak, one to three.
--     Empty means "not said yet": every account made before this migration,
--     and any guest. Nothing reads it as a filter; it orders the app's picker
--     and defaults a host's room language.
--   · rooms.language — the room's language, picked by the host at go-live.
--     Rooms started by an app that predates this get 'hi' from the default,
--     which is what keeps this migration expand-only (CLAUDE.md invariant 12).
--
-- The checks are on SHAPE (an ISO 639 code) and not on a list, so adding a
-- language is an edit to src/shared/languages.ts and the app — never a
-- migration. The API is what holds the list.
-- ---------------------------------------------------------------------------

ALTER TABLE user_profiles
  ADD COLUMN languages text[] NOT NULL DEFAULT '{}'
    CHECK (
      cardinality(languages) <= 3
      AND array_to_string(languages, ',') ~ '^([a-z]{2,3}(,[a-z]{2,3})*)?$'
    );

ALTER TABLE rooms
  ADD COLUMN language text NOT NULL DEFAULT 'hi'
    CHECK (language ~ '^[a-z]{2,3}$');

-- The feed filtered to one language, in the order it is always read. Partial
-- on live rooms, like rooms_live_idx, so history never enters it.
CREATE INDEX rooms_live_language_idx ON rooms (language, viewer_count DESC, started_at DESC)
  WHERE ended_at IS NULL;
