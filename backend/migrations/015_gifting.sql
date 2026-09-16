-- ---------------------------------------------------------------------------
-- 015 · Gifting — the send path's own record, and gift art on the contract
--
-- The ledger already knows how to move a gift's money (the eight legs in
-- economy/flows.ts). What it cannot answer cheaply is anything a PRODUCT asks:
-- who gave the most in this room, what did this host earn today, which gift
-- was it. The ledger stores accounts and amounts; the gift, the room and the
-- recipient are only inside a jsonb identity blob.
--
-- So every send also writes one `gift_sends` row — INSIDE the same database
-- transaction as its ledger entries. That is the whole design: the row cannot
-- exist without the money having moved, and the money cannot move without the
-- row. A leaderboard fed by an event subscriber would be eventually consistent
-- with the ledger; this one is simply consistent, and reconciliation checks it.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- gift_sends
-- ---------------------------------------------------------------------------
CREATE TABLE gift_sends (
  -- One row per ledger transaction, and the transaction id IS the gift id
  -- clients dedupe on.
  txn_id             uuid PRIMARY KEY REFERENCES ledger_txns(id),
  room_id            uuid NOT NULL REFERENCES rooms(id),
  sender_user_id     uuid NOT NULL REFERENCES users(id),
  -- The host, or anyone on a seat in a party room.
  recipient_user_id  uuid NOT NULL REFERENCES users(id),
  gift_id            text NOT NULL REFERENCES gift_catalog(id),

  -- The combo multipliers and nothing else. An arbitrary quantity would turn
  -- one tap into any amount of money.
  quantity           integer NOT NULL CHECK (quantity IN (1, 10, 99, 520, 999)),

  -- Copied, not joined. The catalog is retuned three months after launch and a
  -- join would silently reprice every historical gift (ledger-decisions § G1).
  unit_price         bigint  NOT NULL CHECK (unit_price > 0),
  coins              bigint  NOT NULL CHECK (coins > 0),
  points             bigint  NOT NULL CHECK (points >= 0),
  payout_rate_bp     integer NOT NULL CHECK (payout_rate_bp BETWEEN 0 AND 10000),

  created_at         timestamptz NOT NULL DEFAULT now(),

  -- Gifting yourself is refused in the service. This is the backstop: coins
  -- bought on a stolen card and gifted to your own account come back out as a
  -- bank payout, which is the cash-out half of card fraud.
  CONSTRAINT gift_sends_not_self CHECK (sender_user_id <> recipient_user_id),
  CONSTRAINT gift_sends_coins_match CHECK (coins = unit_price * quantity)
);

-- The room leaderboard: sum per sender within a room, answered from the index.
CREATE INDEX gift_sends_room_sender_idx ON gift_sends (room_id, sender_user_id) INCLUDE (coins);
-- A host's earnings, newest first (M8).
CREATE INDEX gift_sends_recipient_idx ON gift_sends (recipient_user_id, created_at DESC);
-- A user's own sending history, and the fraud signals keyed on it (M9).
CREATE INDEX gift_sends_sender_idx ON gift_sends (sender_user_id, created_at DESC);

-- Append-only, like the ledger it mirrors. A gift that happened stays happened;
-- a correction is a reversal in the ledger, never an edit here.
CREATE OR REPLACE FUNCTION gift_sends_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gift_sends is append-only (attempted % on %)', TG_OP, OLD.txn_id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gift_sends_immutable
  BEFORE UPDATE OR DELETE ON gift_sends
  FOR EACH ROW EXECUTE FUNCTION gift_sends_immutable();


-- ---------------------------------------------------------------------------
-- Gift art, onto the asset contract (docs/asset-contract.md)
-- ---------------------------------------------------------------------------

-- The static picture of a gift. Every gift has one — the gift sheet, the strips
-- and every "sent a Rose" line draw it.
ALTER TABLE gift_catalog ADD COLUMN icon_asset text;

-- Versioned, immutable paths, under `placeholder/` until real art is uploaded.
-- The prefix is what the production reconciliation check refuses, so a stand-in
-- cannot quietly ship.
--
-- Tier 1–2 lose their animation path entirely. Nothing plays a `basic` gift
-- full-screen — the strip is their display — so a path there only invites
-- someone to brief and pay for art no user will ever see.
UPDATE gift_catalog
   SET icon_asset      = 'placeholder/gifts/' || id || '/icon.v1.webp',
       animation_asset = CASE WHEN effect = 'basic' THEN NULL
                              ELSE 'placeholder/gifts/' || id || '/anim.v1.json' END,
       updated_at      = now();

ALTER TABLE gift_catalog
  ADD CONSTRAINT gift_catalog_basic_has_no_animation
  CHECK (effect <> 'basic' OR animation_asset IS NULL);

COMMENT ON COLUMN gift_catalog.icon_asset IS
  'Static WebP, 256x256, subject inside the central 216x216, <= 30KB. '
  'Path scheme gifts/{id}/icon.v{n}.webp — never overwrite, bump the version. '
  'See docs/asset-contract.md section 2.';

COMMENT ON COLUMN gift_catalog.animation_asset IS
  'Lottie JSON for full-screen effects only (tiers 3-5); NULL for basic gifts. '
  'Path scheme gifts/{id}/anim.v{n}.json — never overwrite, bump the version. '
  'Canvas, duration and size budgets per tier are in docs/asset-contract.md section 3.';
