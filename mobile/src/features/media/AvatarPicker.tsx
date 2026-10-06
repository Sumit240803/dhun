import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { colors, radius } from '@/theme';
import { Avatar, Banner, Column, Text } from '@/ui';

import { pickImage, uploadImage } from './upload';

/**
 * Tap your own face to change it.
 *
 * The avatar IS the control — no separate "upload photo" button, because the
 * thing being changed is right there and tapping it is what everyone tries
 * first. The camera badge exists so it does not look like a static image.
 *
 * While it uploads the avatar stays put under a spinner rather than being
 * replaced by one: the picture is the subject of the screen and swapping it for
 * a grey box makes a two-second upload feel like a reset.
 */
export function AvatarPicker({
  name,
  uri,
  onUploaded,
  size = 96,
}: {
  name: string;
  uri: string | null;
  /**
   * Called with the upload KEY, and the local file uri.
   *
   * The uri is what makes the new photo appear INSTANTLY. The object is in the
   * bucket by now, but its public URL can take a moment to be readable, and
   * someone who just chose a picture should see that picture — not their old
   * one for another two seconds.
   */
  onUploaded: (key: string, localUri: string) => void | Promise<void>;
  size?: number;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function choose() {
    if (busy) return;
    haptic.tap();
    setError(undefined);
    setBusy(true);
    try {
      const picked = await pickImage('avatar');
      // Null means they closed the picker or declined access to photos —
      // an ordinary choice, not a failure to report.
      if (picked !== null) {
        const key = await uploadImage('avatar', picked);
        await onUploaded(key, picked.uri);
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
    <Column gap="sm" align="center">
      <Pressable
        onPress={() => void choose()}
        accessibilityRole="button"
        accessibilityLabel={t('profile.changePhoto')}
        accessibilityState={{ busy }}
        disabled={busy}
        testID="avatar-picker"
      >
        <View>
          <Avatar name={name} uri={uri} size="xl" />

          {busy && (
            <View style={[styles.overlay, { width: size, height: size, borderRadius: size / 2 }]}>
              <ActivityIndicator color={colors.text.onBrand} />
            </View>
          )}

          <View style={styles.badge}>
            <Ionicons name="camera" size={14} color={colors.text.onBrand} />
          </View>
        </View>
      </Pressable>

      <Text variant="caption" tone="secondary">
        {t('profile.changePhoto')}
      </Text>

      {error !== undefined && <Banner message={error} testID="avatar-error" />}
    </Column>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.scrim,
  },
  badge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.solid,
    borderWidth: 2,
    borderColor: colors.bg.surface,
  },
});
