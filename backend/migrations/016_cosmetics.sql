-- ---------------------------------------------------------------------------
-- 016 · Cosmetics — owning, wearing and expiring
--
-- Gems are 19–37% of every coin pack. Until this migration they bought nothing,
-- which means the margin design in CLAUDE.md did not exist: cosmetics are the
-- zero-payout path that carries it.
--
-- M7 ships four kinds: avatar frame, chat bubble, nickname colour, entry effect.
-- Super messages and VIP tiers stay out (Phase 1), and free unlocks by user
-- level wait until level progression is visible anywhere in the app.
--
-- Decisions: backend/docs/ledger-decisions.md § C11c, C11d.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- The catalog: art paths and style data
-- ---------------------------------------------------------------------------

-- What a cosmetic LOOKS like when it is data rather than a file — bubble and
-- name colours, and the drawn fallback for frames and entry effects when their
-- art has not loaded. Light and dark variants, because the app has both
-- palettes and a colour chosen for one is often unreadable on the other.
-- Validated on read by src/shared/cosmeticStyle.ts; see docs/asset-contract.md § 6.
ALTER TABLE cosmetics ADD COLUMN style jsonb;

-- Lets user_cosmetics carry the kind with a foreign key guaranteeing it is the
-- RIGHT kind — the "one equipped per kind" index below depends on it.
ALTER TABLE cosmetics ADD CONSTRAINT cosmetics_id_kind_key UNIQUE (id, kind);

-- Single-use, and not in M7. Hidden rather than deleted so its price stays in
-- one place for when it ships.
UPDATE cosmetics SET is_active = false WHERE kind = 'super_message';

-- Distinct names, now that each kind has more than one item.
UPDATE cosmetics SET name = 'Saffron Name',  sort_order = 1 WHERE id = 'nickname_color';
UPDATE cosmetics SET name = 'Golden Bubble', sort_order = 11 WHERE id = 'chat_bubble';
UPDATE cosmetics SET name = 'Classic Frame', sort_order = 21 WHERE id = 'frame_basic';
UPDATE cosmetics SET name = 'Sparkle Entry', sort_order = 31 WHERE id = 'entry_basic';
UPDATE cosmetics SET name = 'Royal Entry',   sort_order = 32 WHERE id = 'entry_premium';

-- More than one of each wearable kind, at the SAME price as the item already
-- seeded for that kind — choice changes nothing about the economy, and a store
-- with a single item per shelf cannot show what choosing looks like.
INSERT INTO cosmetics (id, name, kind, gem_price, duration_days, sort_order, is_active) VALUES
  ('nickname_rose',  'Rose Name',      'nickname_color', 1300, 30,  2, true),
  ('nickname_teal',  'Teal Name',      'nickname_color', 1300, 30,  3, true),
  ('bubble_rose',    'Rose Bubble',    'chat_bubble',    1950, 30, 12, true),
  ('bubble_night',   'Midnight Bubble','chat_bubble',    1950, 30, 13, true),
  ('frame_rose',     'Rose Frame',     'frame',          3250, 30, 22, true),
  ('frame_ocean',    'Ocean Frame',    'frame',          3250, 30, 23, true);

-- Art on the asset contract's versioned, placeholder-prefixed paths. Bubbles
-- and name colours have no file at all — they are style data (§ 6).
UPDATE cosmetics SET asset = 'placeholder/frames/' || id || '.v1.webp' WHERE kind = 'frame';
UPDATE cosmetics SET asset = 'placeholder/entry/'  || id || '.v1.json' WHERE kind = 'entry_effect';

UPDATE cosmetics SET style = '{"light":{"color":"#B45309"},"dark":{"color":"#FBBF24"}}'  WHERE id = 'nickname_color';
UPDATE cosmetics SET style = '{"light":{"color":"#BE185D"},"dark":{"color":"#F9A8D4"}}'  WHERE id = 'nickname_rose';
UPDATE cosmetics SET style = '{"light":{"color":"#0F766E"},"dark":{"color":"#5EEAD4"}}'  WHERE id = 'nickname_teal';

UPDATE cosmetics SET style =
  '{"light":{"background":"#FEF3C7","border":"#F59E0B","text":"#78350F"},
    "dark":{"background":"#78350F","border":"#FBBF24","text":"#FEF3C7"}}' WHERE id = 'chat_bubble';
UPDATE cosmetics SET style =
  '{"light":{"background":"#FCE7F3","border":"#EC4899","text":"#831843"},
    "dark":{"background":"#831843","border":"#F472B6","text":"#FCE7F3"}}' WHERE id = 'bubble_rose';
UPDATE cosmetics SET style =
  '{"light":{"background":"#E0E7FF","border":"#6366F1","text":"#312E81"},
    "dark":{"background":"#312E81","border":"#818CF8","text":"#E0E7FF"}}' WHERE id = 'bubble_night';

UPDATE cosmetics SET style = '{"light":{"ring":"#D97706"},"dark":{"ring":"#FBBF24"}}' WHERE id = 'frame_basic';
UPDATE cosmetics SET style = '{"light":{"ring":"#DB2777"},"dark":{"ring":"#F472B6"}}' WHERE id = 'frame_rose';
UPDATE cosmetics SET style = '{"light":{"ring":"#0284C7"},"dark":{"ring":"#38BDF8"}}' WHERE id = 'frame_ocean';

UPDATE cosmetics SET style = '{"light":{"accent":"#7C3AED"},"dark":{"accent":"#A78BFA"}}' WHERE id = 'entry_basic';
UPDATE cosmetics SET style = '{"light":{"accent":"#B45309"},"dark":{"accent":"#FBBF24"}}' WHERE id = 'entry_premium';

-- Every wearable kind must be drawable. VIP and super message are not worn.
ALTER TABLE cosmetics
  ADD CONSTRAINT cosmetics_wearable_has_style
  CHECK (kind IN ('vip', 'super_message') OR style IS NOT NULL);


-- ---------------------------------------------------------------------------
-- user_cosmetics · what someone owns, until when, and what they are wearing
-- ---------------------------------------------------------------------------
CREATE TABLE user_cosmetics (
  user_id            uuid NOT NULL REFERENCES users(id),
  cosmetic_id        text NOT NULL,
  kind               text NOT NULL,
  -- Evaluated on read. Nothing sweeps expired rows: a lapsed item stops being
  -- drawn the moment the clock passes this, and buying it again extends the
  -- same row rather than creating another.
  expires_at         timestamptz NOT NULL,
  equipped           boolean NOT NULL DEFAULT false,
  first_acquired_at  timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, cosmetic_id),
  FOREIGN KEY (cosmetic_id, kind) REFERENCES cosmetics (id, kind)
);

-- One frame, one bubble, one name colour, one entry effect at a time.
CREATE UNIQUE INDEX user_cosmetics_one_equipped_per_kind
  ON user_cosmetics (user_id, kind) WHERE equipped;

CREATE TRIGGER user_cosmetics_updated_at BEFORE UPDATE ON user_cosmetics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- cosmetic_purchases · one row per purchase, in the ledger's transaction
--
-- user_cosmetics says what is owned NOW; this says how it came to be. Support
-- answering "I paid and my frame vanished" needs the second, and a refund needs
-- to know exactly how much time a purchase added.
-- ---------------------------------------------------------------------------
CREATE TABLE cosmetic_purchases (
  txn_id          uuid PRIMARY KEY REFERENCES ledger_txns(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  cosmetic_id     text NOT NULL REFERENCES cosmetics(id),
  gems            bigint  NOT NULL CHECK (gems > 0),
  duration_days   integer NOT NULL CHECK (duration_days > 0),
  -- The expiry this purchase produced — later than now + duration when it
  -- extended an item that was still active.
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cosmetic_purchases_user_idx ON cosmetic_purchases (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION cosmetic_purchases_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cosmetic_purchases is append-only (attempted % on %)', TG_OP, OLD.txn_id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cosmetic_purchases_immutable
  BEFORE UPDATE OR DELETE ON cosmetic_purchases
  FOR EACH ROW EXECUTE FUNCTION cosmetic_purchases_immutable();
