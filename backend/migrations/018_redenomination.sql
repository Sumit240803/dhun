-- ---------------------------------------------------------------------------
-- 018 · Redenomination ×2
--
-- Every coin, gem and point figure in the catalog and the config is doubled.
-- Rupee prices do not move: a ₹99 pack that gave 5,445 coins now gives 10,890,
-- and the Yacht that cost 15,500 costs 31,000.
--
-- WHY. Competing apps quote coins in the hundreds of thousands, and a user who
-- has seen one of those reads our balance as small. Doubling the count doubles
-- the number on the screen without moving a single rupee price.
--
-- WHY IT IS FREE. The payout ratio is `coins per ₹ ÷ 216.7` measured against the
-- point rate, and BOTH sides double — 110 coins/₹ against 260 points/₹ is the
-- same 25.4% as 55 against 130. A gift of 2,000 new coins pays the same rupees
-- to the same host as a gift of 1,000 old ones. The only thing that changes is
-- the size of the numerals.
--
-- ####################################################################
-- # THIS MIGRATION IS SAFE ONLY BEFORE LAUNCH.                       #
-- #                                                                  #
-- # It rewrites PRICES. It cannot rewrite BALANCES: the ledger is     #
-- # append-only by trigger and by revoked grants, which is the point  #
-- # of it. So any balance that exists when this runs keeps its old    #
-- # magnitude while every price around it doubles — i.e. every        #
-- # existing user silently loses half their purchasing power.         #
-- #                                                                  #
-- # After launch this same change needs a compensating credit per     #
-- # account (a `redenomination` txn type minting the matching half    #
-- # against system:coin_float), not an UPDATE. Do not reuse this file #
-- # for that.                                                        #
-- ####################################################################
-- ---------------------------------------------------------------------------

-- Say out loud what is about to be devalued, so this is never a silent surprise
-- on a database that already has money in it.
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n
    FROM account_balances b
    JOIN ledger_accounts a ON a.id = b.account_id
   WHERE a.scope_type IN ('user', 'host') AND b.balance <> 0;

  IF n > 0 THEN
    RAISE WARNING 'redenomination: % non-zero user/host balances keep their OLD magnitude while prices double. Pre-launch only — see the header of 018.', n;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- Rates
--
-- The two bp rates do NOT double: a basis point is a ratio, and 60% of a
-- doubled coin count is already a doubled point count. Doubling them too would
-- double the real payout ratio, which is the one number this migration exists
-- to leave alone.
-- ---------------------------------------------------------------------------
UPDATE app_config SET
  value = '130'::jsonb,
  description = 'Accounting face value only: 130 coins or gems = ₹1. Used for deferred revenue so every unit is worth the same everywhere. NOT what a user pays.'
 WHERE key = 'face_value_units_per_rupee';

UPDATE app_config SET
  value = '110'::jsonb,
  description = 'What a buyer actually receives. THE margin dial — payout ratio is exactly this ÷ 433.4 (half of 216.7, because the point rate doubled with it).'
 WHERE key = 'pack_coins_per_rupee';

UPDATE app_config SET
  value = '260'::jsonb,
  description = 'Host earnings. A point is worth half a coin, which turns an advertised 60% split into a real 30% payout.'
 WHERE key = 'points_per_rupee';

UPDATE app_config SET value = '200'::jsonb WHERE key = 'min_conversion_coins';


-- ---------------------------------------------------------------------------
-- Catalogs. Rupee prices (price_paise) are untouched.
-- ---------------------------------------------------------------------------
UPDATE coin_packs       SET coins = coins * 2, gems = gems * 2;
UPDATE gift_catalog     SET coin_price = coin_price * 2;
UPDATE cosmetics        SET gem_price = gem_price * 2;
UPDATE level_thresholds SET min_value = min_value * 2;

-- Two hand-tuned exceptions, both within 4% of the pure double, so the
-- sentimental combo multipliers keep a gift priced exactly on them. x520 and
-- x999 are the two multipliers users tap for what they mean, and a ladder where
-- no gift costs 520 or 999 loses that. Doubling moved them to 1,040 and 1,998,
-- so they are re-seated on the two gifts that land nearest.
UPDATE gift_catalog SET coin_price =  520 WHERE id = 'clap';     -- 500 → 520
UPDATE gift_catalog SET coin_price =  999 WHERE id = 'perfume';  -- 1,040 → 999


-- ---------------------------------------------------------------------------
-- Free coin amounts. The rupee and time fields inside the same JSON — the
-- referral's minimum qualifying purchase, the watch minutes, the caps and the
-- attach window — are NOT coin counts and do not move.
-- ---------------------------------------------------------------------------
UPDATE app_config SET value = jsonb_build_object(
    'signup',        (value -> 'signup')::bigint * 2,
    'checkinLadder', (
      SELECT jsonb_agg(((d)::bigint * 2)::text::jsonb ORDER BY i)
        FROM jsonb_array_elements_text(value -> 'checkinLadder') WITH ORDINALITY AS t(d, i)
    ),
    'watch',         (value -> 'watch')
                       || jsonb_build_object('coins', (value -> 'watch' -> 'coins')::bigint * 2),
    'referral',      (value -> 'referral')
                       || jsonb_build_object('coins', (value -> 'referral' -> 'coins')::bigint * 2)
  )
 WHERE key = 'free_coins';


-- ---------------------------------------------------------------------------
-- Counters. lifetime_purchased_coins drives user level, and the level
-- thresholds above just doubled — so leaving it would demote every user who has
-- bought anything. There is no ledger constraint here; it is a derived counter.
-- ---------------------------------------------------------------------------
UPDATE user_stats SET lifetime_purchased_coins = lifetime_purchased_coins * 2
 WHERE lifetime_purchased_coins > 0;
