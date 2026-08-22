-- ============================================================================
-- 005 · Gift animations move from SVGA to Lottie
--
-- 003 seeded `gifts/rose.svga`, following the live-streaming industry standard —
-- Bigo, Poppo, MLive and Chamet all use SVGA, and the gift marketplaces sell it.
--
-- It cannot be used here. Every SVGA React Native binding is abandoned:
--   react-native-svga        last published 2022-05-14
--   svgaplayer-react-native  last published 2022-05-19
-- Both predate the New Architecture, and React Native 0.82 removed the old
-- bridge entirely, so they cannot work at all.
--
-- The reason is structural rather than accidental: every app using SVGA or PAG
-- is NATIVE Android/iOS. Those formats came from Chinese platform teams with
-- in-house native engineers, so nobody ever needed a React Native binding.
--
-- Lottie is the only maintained option, and its After Effects export path means
-- deep, affordable designer supply in India. PAG (Tencent — WeChat, QQ, Honor of
-- Kings) is technically better but has no React Native SDK. Rive is a stronger
-- runtime with a thinner hiring pool.
--
-- Nothing about the format is baked into the schema: animation_asset is a plain
-- string and `effect` drives rendering separately, so a Rive renderer could be
-- added per gift later without another migration.
-- ============================================================================

UPDATE gift_catalog
   SET animation_asset = regexp_replace(animation_asset, '\.svga$', '.json'),
       updated_at = now()
 WHERE animation_asset LIKE '%.svga';

-- Every seeded gift must have ended up on a Lottie path. A leftover .svga would
-- render as the text fallback in production — visible, but not until someone
-- has paid for that gift.
DO $$
DECLARE
  stragglers integer;
BEGIN
  SELECT count(*) INTO stragglers FROM gift_catalog WHERE animation_asset LIKE '%.svga';
  IF stragglers > 0 THEN
    RAISE EXCEPTION '% gift(s) still reference an .svga asset', stragglers;
  END IF;
END
$$;

COMMENT ON COLUMN gift_catalog.animation_asset IS
  'Path to a Lottie JSON, resolved against the CDN base by the client. '
  'Brief designers for: After Effects via Bodymovin, 750x750 minimum, under '
  '500KB, transparent background, no expressions, no merge paths. '
  'Always keep the AE source — it is what keeps the format decision reversible.';
