-- ---------------------------------------------------------------------------
-- 021 · The agency coin channel goes live
--
-- Migration 019 seeded `reseller_prepay` and `purchase_reseller` INACTIVE,
-- because the service that writes them did not exist and a transaction type
-- nothing can post is a kill switch waiting to be forgotten. It exists now, so
-- this is the release step.
--
-- `is_active` stays the money-layer kill switch (day-1 non-negotiable #5): set
-- either of these false and that flow stops platform-wide, atomically, with no
-- deploy. Incidents: kill switch first, fix second.
-- ---------------------------------------------------------------------------

UPDATE ledger_txn_types SET is_active = true
 WHERE code IN ('reseller_prepay', 'purchase_reseller');


-- ---------------------------------------------------------------------------
-- The inventory account is non-negative, which IS hard rule #3.
--
-- `allow_negative` defaults to false for every scoped account, and economy's
-- account resolver creates them that way. This asserts it rather than trusting
-- it: if an agency inventory account could ever run negative, an agency could
-- sell coins it had not paid for, and we would be a lender rather than a
-- distributor.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
    FROM ledger_accounts
   WHERE scope_type = 'agency' AND code = 'agency_inventory' AND allow_negative;

  IF bad > 0 THEN
    RAISE EXCEPTION 'agency inventory accounts must be non-negative (% found that are not)', bad;
  END IF;
END $$;
