-- ============================================================================
-- 026 · Chai and Laddu leave the catalog; Candy and Balloon take their places
--
-- Both were regional by name: a chai glass and a laddu read instantly in Delhi
-- and not at all outside it. Tier 1 is the tier every new user meets first and
-- the one the art brief anchors on, so its five icons have to be legible before
-- anyone knows what the app is. Candy and Balloon are the same gesture — a
-- small, cheap token of attention — drawn from objects nobody has to be taught.
--
-- Nothing else in the ladder moves. Rose, Teddy, Guitar, Cake, Bouquet, Scooter
-- and the rest are already universal, and renaming them would cost the one
-- thing the catalog's naming has going for it: it is settled.
--
-- WHY THIS IS NOT AN UPDATE OF `gift_catalog.id`
--
-- `gift_sends.gift_id` references `gift_catalog(id)` with no ON UPDATE CASCADE,
-- and `gift_sends` is append-only by trigger — a gift that happened stays
-- happened. So the rows pointing at 'chai' and 'laddu' cannot be repointed and
-- must not be deleted: each one is written inside a ledger transaction, and
-- removing it would leave a ledger entry describing a gift that no longer
-- exists (invariant 7).
--
-- So the old rows are DEACTIVATED, not renamed. `is_active = false` withholds
-- them from the catalog the app reads and from the gift sheet, while leaving
-- every past send resolvable. They need no art: the reconciliation check that
-- refuses `placeholder/` paths looks at active gifts only.
--
-- On a fresh database (`npm run db:reset`) they are gone entirely, because 003
-- is where they were seeded and the two inserts below are the only trace.
-- ============================================================================

-- Prices are TODAY's, not 003's. Migration 018 doubled every coin_price, so a
-- new row must be inserted at the doubled figure or it would undercut the
-- ladder: 170 and 330, matching the 85 and 165 these two replace.
--
-- No animation_asset. Tier 1 is `basic` effect, nothing plays it full-screen,
-- and `gift_catalog_basic_has_no_animation` enforces that.
INSERT INTO gift_catalog (id, name, tier, coin_price, effect, icon_asset, sort_order) VALUES
  ('candy',   'Candy',   1, 170, 'basic', 'placeholder/gifts/candy/icon.v1.webp',   3),
  ('balloon', 'Balloon', 1, 330, 'basic', 'placeholder/gifts/balloon/icon.v1.webp', 4);

UPDATE gift_catalog
   SET is_active = false,
       updated_at = now()
 WHERE id IN ('chai', 'laddu');

-- Tier 1 must still be exactly five gifts at the five prices the pack cascades
-- were built against. A ladder with a hole in it, or with seven rungs because a
-- deactivation silently failed, is the kind of thing nobody notices until a
-- designer asks which five to draw.
DO $$
DECLARE
  prices bigint[];
BEGIN
  SELECT array_agg(coin_price ORDER BY coin_price)
    INTO prices
    FROM gift_catalog
   WHERE tier = 1 AND is_active;

  IF prices <> ARRAY[20, 90, 170, 330, 520]::bigint[] THEN
    RAISE EXCEPTION 'Tier 1 is no longer the five expected prices: %', prices;
  END IF;
END
$$;
