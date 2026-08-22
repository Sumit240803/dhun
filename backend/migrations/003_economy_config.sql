-- ============================================================================
-- 003 · Server-driven economy config, purchases, and user stats
--
-- Day-1 non-negotiable #6: the gift catalog, coin packs, level thresholds and
-- room types are CONFIG, not code. Adding a gift or changing a price must never
-- require an app release, because old app versions stay alive forever.
--
-- All prices here are integers. Coins and gems are whole units; money is paise.
-- Percentages are basis points (6000 = 60.00%).
--
-- The numbers seeded below supersede economy-design-v1.pdf — see CLAUDE.md.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- app_config · the dials
--
-- Kept as key/jsonb rather than columns so a new dial is an INSERT. Every value
-- an operator might retune three months after launch lives here.
-- ---------------------------------------------------------------------------
CREATE TABLE app_config (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id)
);

CREATE TRIGGER app_config_updated_at BEFORE UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO app_config (key, value, description) VALUES
  ('face_value_units_per_rupee', '65',
   'Accounting face value only: 65 coins or gems = ₹1. Used for deferred revenue so every unit is worth the same everywhere. NOT what a user pays.'),
  ('pack_coins_per_rupee', '55',
   'What a buyer actually receives. THE margin dial — payout ratio is exactly this ÷ 216.7.'),
  ('points_per_rupee', '130',
   'Host earnings. A point is worth half a coin, which turns an advertised 60% split into a real 30% payout.'),
  ('coin_to_gem_rate_bp', '12000',
   'Coins to gems, ONE WAY, +20%. Never build the reverse: gems converting back to coins would collapse the payout design.'),
  ('default_gift_payout_rate_bp', '6000',
   'Fallback only. payout_rate_bp is a PER-GIFT field so event gifts can differ.'),
  ('free_coin_budget_bp_of_revenue', '800',
   'Free coin spend ceiling: 8% of paid coin revenue.'),
  ('min_conversion_coins', '100',
   'Smallest coins→gems conversion, to keep the ledger free of dust transactions.');


-- ---------------------------------------------------------------------------
-- coin_packs
--
-- Totals are unchanged from the source doc so advertised value is preserved —
-- only the coin/gem split is new. Starter is deliberately off-formula (105
-- coins/₹): its job is teaching the gifting loop, not margin.
-- ---------------------------------------------------------------------------
CREATE TABLE coin_packs (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  price_paise          bigint NOT NULL CHECK (price_paise > 0),
  coins                bigint NOT NULL CHECK (coins >= 0),
  gems                 bigint NOT NULL CHECK (gems >= 0),
  badge                text,
  -- Store product ids must match the Play/App Store price tiers. Where an exact
  -- ₹19/₹99 tier is unavailable, the nearest tier is used.
  play_product_id      text,
  appstore_product_id  text,
  lifetime_once        boolean NOT NULL DEFAULT false,
  sort_order           smallint NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  visible_from         timestamptz,
  visible_to           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER coin_packs_updated_at BEFORE UPDATE ON coin_packs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO coin_packs
  (id, name, price_paise, coins, gems, badge, play_product_id, lifetime_once, sort_order) VALUES
  ('starter_19',  'Starter', 1900,   2000,   3300, 'Best value',  'coins_starter_19',  true,  1),
  ('small_99',    'Small',   9900,   5445,   1305, NULL,          'coins_small_99',    false, 2),
  ('popular_299', 'Popular', 29900,  16445,  5355, 'Most Popular','coins_popular_299', false, 3),
  ('value_999',   'Value',   99900,  54945,  23055, NULL,         'coins_value_999',   false, 4),
  ('big_2999',    'Big',     299900, 164945, 84555, NULL,         'coins_big_2999',    false, 5),
  ('whale_9999',  'Whale',   999900, 549945, 327555, NULL,        'coins_whale_9999',  false, 6);


-- ---------------------------------------------------------------------------
-- gift_catalog
--
-- payout_rate_bp is PER GIFT (day-1 non-negotiable #12), never a global
-- constant, so seasonal and event gifts can carry a different rate later.
--
-- Prices are the 55 coins/₹ repricing. Gift prices do NOT affect the payout
-- ratio — that is set only by coins-per-₹ in the packs — so this ladder is tuned
-- purely so each pack affords a hero gift and cascades down to an awkward
-- remainder.
-- ---------------------------------------------------------------------------
CREATE TABLE gift_catalog (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  tier             smallint NOT NULL CHECK (tier BETWEEN 1 AND 5),
  coin_price       bigint NOT NULL CHECK (coin_price > 0),
  payout_rate_bp   integer NOT NULL DEFAULT 6000 CHECK (payout_rate_bp BETWEEN 0 AND 10000),
  effect           text NOT NULL CHECK (effect IN
                     ('basic','fullscreen','room_banner','global_announcement')),
  animation_asset  text,
  sort_order       smallint NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  visible_from     timestamptz,
  visible_to       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER gift_catalog_updated_at BEFORE UPDATE ON gift_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_gift_catalog_active ON gift_catalog (tier, sort_order) WHERE is_active;

INSERT INTO gift_catalog (id, name, tier, coin_price, effect, animation_asset, sort_order) VALUES
  -- Tier 1 · Impulse
  ('heart',        'Heart',        1,      10, 'basic',       'gifts/heart.svga',        1),
  ('rose',         'Rose',         1,      45, 'basic',       'gifts/rose.svga',         2),
  ('chai',         'Chai',         1,      85, 'basic',       'gifts/chai.svga',         3),
  ('laddu',        'Laddu',        1,     165, 'basic',       'gifts/laddu.svga',        4),
  ('clap',         'Clap',         1,     250, 'basic',       'gifts/clap.svga',         5),
  -- Tier 2 · Regular. 520 and 999 echo the sentimental combo multipliers and are kept.
  ('perfume',      'Perfume',      2,     520, 'basic',       'gifts/perfume.svga',      6),
  ('teddy',        'Teddy',        2,     999, 'basic',       'gifts/teddy.svga',        7),
  ('guitar',       'Guitar',       2,    1250, 'basic',       'gifts/guitar.svga',       8),
  ('cake',         'Cake',         2,    1650, 'basic',       'gifts/cake.svga',         9),
  ('bouquet',      'Bouquet',      2,    2200, 'basic',       'gifts/bouquet.svga',     10),
  -- Tier 3 · Statement. Scooter is NEW: it bridges the Tier 2→3 gap the source
  -- doc predicts will break first, and is the cheapest full-screen gift.
  ('scooter',      'Scooter',      3,    3300, 'fullscreen',  'gifts/scooter.svga',     11),
  ('fireworks',    'Fireworks',    3,    4150, 'fullscreen',  'gifts/fireworks.svga',   12),
  ('motorbike',    'Motorbike',    3,    6600, 'fullscreen',  'gifts/motorbike.svga',   13),
  ('diamond_ring', 'Diamond Ring', 3,    9900, 'fullscreen',  'gifts/diamond_ring.svga',14),
  ('yacht',        'Yacht',        3,   15500, 'fullscreen',  'gifts/yacht.svga',       15),
  -- Tier 4 · Flex
  ('sports_car',   'Sports Car',   4,   45000, 'room_banner', 'gifts/sports_car.svga',  16),
  ('private_jet',  'Private Jet',  4,   82500, 'room_banner', 'gifts/private_jet.svga', 17),
  ('castle',       'Castle',       4,  145000, 'room_banner', 'gifts/castle.svga',      18),
  -- Tier 5 · Global. This tier is the real product: the user is paying to be
  -- seen by everyone, not to enrich one host.
  ('rocket',       'Rocket',       5,  400000, 'global_announcement', 'gifts/rocket.svga', 19),
  ('galaxy',       'Galaxy',       5,  825000, 'global_announcement', 'gifts/galaxy.svga', 20);


-- ---------------------------------------------------------------------------
-- cosmetics · priced in GEMS, zero host payout. This is the margin path.
--
-- Everything expires. A permanent item is one-time revenue; an expiring one is
-- monthly recurring.
-- ---------------------------------------------------------------------------
CREATE TABLE cosmetics (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  kind           text NOT NULL CHECK (kind IN
                   ('frame','chat_bubble','entry_effect','nickname_color','super_message','vip')),
  gem_price      bigint NOT NULL CHECK (gem_price > 0),
  duration_days  integer,          -- NULL = single use (e.g. super message)
  asset          text,
  -- Set where a user level unlocks this item for free (cosmetic_grant).
  free_at_user_level smallint,
  sort_order     smallint NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  visible_from   timestamptz,
  visible_to     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER cosmetics_updated_at BEFORE UPDATE ON cosmetics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Gem prices are unchanged from the source doc: the +20% conversion bonus almost
-- exactly offsets the 55/₹ pack rate (₹1 → 55 coins → 66 gems vs 65), so every
-- item still lands within 1.5% of its designed rupee price.
INSERT INTO cosmetics (id, name, kind, gem_price, duration_days, free_at_user_level, sort_order, is_active) VALUES
  ('nickname_color', 'Nickname Colour',      'nickname_color',  1300,  30, NULL, 1, true),
  ('chat_bubble',    'Chat Bubble',          'chat_bubble',     1950,  30, NULL, 2, true),
  ('frame_basic',    'Profile Frame',        'frame',           3250,  30,   31, 3, true),
  ('super_message',  'Super Message',        'super_message',   5200, NULL, NULL, 4, true),
  ('entry_basic',    'Entry Effect',         'entry_effect',    6500,  30,   16, 5, true),
  ('entry_premium',  'Entry Effect Premium', 'entry_effect',   26000,  30, NULL, 6, true),
  -- VIP tiers are Phase 1: seeded so the numbers live in one place, inactive so
  -- they cannot be bought yet.
  ('vip_silver',     'VIP Silver',           'vip',             6500,  30, NULL, 7, false),
  ('vip_gold',       'VIP Gold',             'vip',            32500,  30, NULL, 8, false),
  ('vip_platinum',   'VIP Platinum',         'vip',           130000,  30, NULL, 9, false),
  ('vip_diamond',    'VIP Diamond',          'vip',           650000,  30, NULL,10, false);


-- ---------------------------------------------------------------------------
-- level_thresholds
--
-- User level accrues on PURCHASE, not on spend. Free coins are ordinary coins
-- now, so scoring on spend would let daily check-ins be ground into levels.
-- Host level accrues on cumulative points earned.
-- ---------------------------------------------------------------------------
CREATE TABLE level_thresholds (
  kind      text NOT NULL CHECK (kind IN ('user','host')),
  level     smallint NOT NULL,
  min_value bigint NOT NULL,       -- user: coins purchased · host: points earned
  unlock    text,
  PRIMARY KEY (kind, level)
);

INSERT INTO level_thresholds (kind, level, min_value, unlock) VALUES
  ('user',  1,        0, 'Basic badge'),
  ('user',  6,     6500, 'Chat colour choice'),
  ('user', 16,    65000, 'Free entry effect'),
  ('user', 31,   650000, 'Free profile frame, priority support'),
  ('user', 51,  6500000, 'Whale tier, dedicated manager'),
  ('host',  1,        0, 'Basic'),
  ('host', 11,    50000, 'Custom room cover, 3 room admins'),
  ('host', 26,   500000, 'Fan club unlock, scheduled live'),
  ('host', 41,  5000000, 'Guardian slots, top-page eligibility');


-- ---------------------------------------------------------------------------
-- user_stats · derived counters kept alongside the ledger
--
-- lifetime_purchased_coins drives user level. It counts only coins BOUGHT, never
-- free grants, which is why it is a counter rather than a ledger query.
-- ---------------------------------------------------------------------------
CREATE TABLE user_stats (
  user_id                 uuid PRIMARY KEY REFERENCES users(id),
  lifetime_purchased_coins bigint NOT NULL DEFAULT 0 CHECK (lifetime_purchased_coins >= 0),
  lifetime_spend_paise     bigint NOT NULL DEFAULT 0 CHECK (lifetime_spend_paise >= 0),
  user_level               smallint NOT NULL DEFAULT 1,
  first_purchase_at        timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- purchases
--
-- Two INDEPENDENT guarantees against double-crediting:
--   1. Idempotency-Key on ledger_txns  — stops OUR CLIENT double-charging
--   2. UNIQUE (provider, provider_txn_id) below — stops ANYONE replaying a
--      captured store receipt under a fresh idempotency key
-- Neither substitutes for the other. Receipt replay is a known fraud route in
-- mobile games.
-- ---------------------------------------------------------------------------
CREATE TABLE purchases (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id),
  pack_id          text NOT NULL REFERENCES coin_packs(id),
  channel          text NOT NULL CHECK (channel IN ('iap','web','reseller')),
  provider         text NOT NULL,      -- google_play | app_store | razorpay
  provider_txn_id  text NOT NULL,
  amount_paise     bigint NOT NULL CHECK (amount_paise > 0),
  -- Snapshot of what was granted. Packs get retuned; a purchase record must not
  -- silently change meaning when they do.
  coins_granted    bigint NOT NULL,
  gems_granted     bigint NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','credited','failed','refunded')),
  ledger_txn_id    uuid REFERENCES ledger_txns(id),
  raw_receipt      jsonb,
  failure_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  credited_at      timestamptz,

  UNIQUE (provider, provider_txn_id)
);

CREATE INDEX idx_purchases_user ON purchases (user_id, created_at DESC);
CREATE INDEX idx_purchases_status ON purchases (status) WHERE status <> 'credited';


-- ---------------------------------------------------------------------------
-- payment_webhooks · raw inbound events, stored before they are trusted
--
-- Kept whether or not processing succeeds: refund and chargeback disputes are
-- argued months later, and the raw payload is the only evidence.
-- ---------------------------------------------------------------------------
CREATE TABLE payment_webhooks (
  id            uuid PRIMARY KEY,
  provider      text NOT NULL,
  event_type    text,
  provider_ref  text,
  payload       jsonb NOT NULL,
  signature     text,
  signature_ok  boolean,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  process_error text
);

CREATE INDEX idx_webhooks_unprocessed ON payment_webhooks (received_at) WHERE processed_at IS NULL;
CREATE INDEX idx_webhooks_ref ON payment_webhooks (provider, provider_ref);
