import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Banner, Column, Text } from '@/ui';

import { pickImage, uploadImage } from './upload';

/**
 * The picture a room wears in the feed.
 *
 * Shown at the tile's own 3:4, and cropped to it in the picker, so a host sees
 * the frame they will actually appear in rather than discovering later that the
 * feed cut their head off.
 *
 * Optional by design: a host with nothing prepared should still be able to go
 * live in two taps, so this is an empty, inviting box and never a blocker.
 */
export function CoverPicker({
  uri,
  onUploaded,
  disabled,
}: {
  uri: string | null;
  onUploaded: (key: string, localUri: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function choose() {
    if (busy || disabled) return;
    haptic.tap();
    setError(undefined);
    setBusy(true);
    try {
      const picked = await pickImage('room_cover');
      if (picked !== null) {
        const key = await uploadImage('room_cover', picked);
        onUploaded(key, picked.uri);
        haptic.success();
      }
    } catch (err) {
      haptic.error();
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Column gap="sm">
      <Text variant="caption" tone="secondary">
        {t('room.coverLabel')}
      </Text>

      <Pressable
        onPress={() => void choose()}
        accessibilityRole="button"
        accessibilityLabel={t('room.coverLabel')}
        accessibilityState={{ busy, disabled }}
        disabled={busy || disabled}
        style={styles.frame}
        testID="cover-picker"
      >
        {uri !== null && <Image source={{ uri }} style={styles.image} contentFit="cover" />}

        {busy ? (
          <ActivityIndicator color={colors.brand.accent} />
        ) : uri === null ? (
          <Column gap="xs" align="center">
            <Ionicons name="image-outline" size={24} color={colors.text.faint} />
            <Text variant="micro" tone="faint">
              {t('room.coverAdd')}
            </Text>
          </Column>
        ) : (
          <View style={styles.changeBadge}>
            <Ionicons name="camera" size={14} color={colors.text.onBrand} />
          </View>
        )}
      </Pressable>

      {error !== undefined && <Banner message={error} />}
    </Column>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 108,
    height: 144,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border.subtle,
    overflow: 'hidden',
  },
  image: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  changeBadge: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.solid,
  },
});
