-- ============================================================================
-- 027 · Rooms get a backdrop
--
-- A party room on a flat ivory page looks like a settings screen with avatars
-- on it. Every app in this category puts the seats on a scene, and the scene is
-- most of what makes a room feel like a place rather than a list.
--
-- THE LIST LIVES IN CONFIG, NOT IN CODE AND NOT IN A TABLE
--
-- `app_config.room_backgrounds` is an ordered array of {id, path}. Adding the
-- fourth, tenth or fiftieth background is an UPDATE to one row — day-1
-- non-negotiable #6, the same rule that keeps the gift catalog out of app
-- releases. A table would have been one more admin surface to build for a list
-- that will never have a hundred entries or a foreign key pointing at it.
--
-- THE CHOICE IS STORED ON THE ROOM, NOT COMPUTED FROM IT
--
-- The obvious shortcut is to hash the room id and pick `list[hash % length]` on
-- the client. It is wrong twice over: adding a background silently reshuffles
-- every live room mid-session, and two clients on different config versions
-- draw different scenes for the same room. `rooms.background_key` pins the
-- choice at creation, so a room looks the same to everyone in it for as long as
-- it lives, and new art only ever affects new rooms.
--
-- A KEY, NOT A PATH
--
-- The column holds `coast-road`, and config holds the path it resolves to.
-- Re-cutting the art is then a config edit (`...v1.webp` → `...v2.webp`), with
-- no UPDATE over a table of rooms, and a key whose entry has been removed
-- simply draws no background rather than a broken image.
-- ============================================================================

ALTER TABLE rooms ADD COLUMN background_key text
  CHECK (background_key IS NULL OR background_key ~ '^[a-z0-9-]{2,40}$');

COMMENT ON COLUMN rooms.background_key IS
  'Which backdrop this room wears, as an id from app_config.room_backgrounds. '
  'Chosen at random when the room is created and never changed afterwards. '
  'NULL, or an id no longer in config, draws the plain gradient.';

-- The three stand-ins shipped with the backend under `public/`, served at the
-- asset base the client already resolves gift art against. Paths are versioned
-- and immutable, exactly as docs/asset-contract.md requires: new art is v2, not
-- an overwrite, because the client caches these forever.
INSERT INTO app_config (key, value, description) VALUES (
  'room_backgrounds',
  '[
     {"id": "coast-road",  "path": "rooms/backgrounds/coast-road.v1.webp"},
     {"id": "ice-stage",   "path": "rooms/backgrounds/ice-stage.v1.webp"},
     {"id": "violet-arc",  "path": "rooms/backgrounds/violet-arc.v1.webp"}
   ]'::jsonb,
  'Room backdrops, as [{id, path}]. One is picked at random per room at creation '
  'and stored in rooms.background_key. Add entries to offer more; removing one '
  'leaves rooms that wear it with no background rather than a broken image.'
);

-- Existing rooms, so a demo database is not half-decorated. Deterministic
-- rather than random: re-running a migration on a restored dump should not
-- reshuffle what everyone already saw.
UPDATE rooms r
   SET background_key = (
         SELECT b->>'id'
           FROM jsonb_array_elements(
                  (SELECT value FROM app_config WHERE key = 'room_backgrounds')
                ) WITH ORDINALITY AS t(b, n)
          WHERE n = 1 + (abs(hashtext(r.id::text))
                         % (SELECT jsonb_array_length(value)
                              FROM app_config WHERE key = 'room_backgrounds'))
       )
 WHERE background_key IS NULL;
