import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, type TierKey } from '@/theme';
import { assetUrl } from './assets';

interface Props {
  /** A catalog path, resolved against the CDN. */
  path: string | null;
  tier: number;
  size: number;
  /** Over a room's scrim rather than a sheet — the fallback glyph goes light. */
  onMedia?: boolean;
}

/**
 * A gift's static picture, with a fallback that is never a blank square.
 *
 * The fallback is the COMMON case until real art is uploaded — every seeded
 * path is a stand-in that may not exist on the CDN yet — and after that it is
 * what a user on a bad connection sees. A gift tile with nothing in it reads as
 * a broken gift, and nobody spends money on one.
 */
export function GiftIcon({ path, tier, size, onMedia = false }: Props) {
  const uri = assetUrl(path);
  // Keyed on the uri: a different gift in the same tile starts fresh rather than
  // inheriting the previous one's failure.
  const [failedUri, setFailedUri] = useState<string | null>(null);

  if (!uri || failedUri === uri) {
    const tint = onMedia
      ? colors.text.onMedia
      : colors.tier[Math.min(Math.max(Math.trunc(tier), 1), 5) as TierKey];
    return (
      <View style={[styles.fallback, { width: size, height: size }]}>
        <Ionicons name="gift" size={Math.round(size * 0.78)} color={tint} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size }}
      contentFit="contain"
      // Icons are immutable per path (docs/asset-contract.md § 1), so the disk
      // cache never needs to ask the CDN again.
      cachePolicy="memory-disk"
      onError={() => setFailedUri(uri)}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
