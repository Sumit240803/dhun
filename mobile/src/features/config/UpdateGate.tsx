import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useAppConfig } from '@/features/config/useAppConfig';
import { useTranslation } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Button, Column, Screen, Text } from '@/ui';

/**
 * Blocks the app when the running version is below the supported floor.
 *
 * Wraps the whole tree rather than living on a screen, because the situation it
 * exists for — a security fix, or a broken money path — must not be reachable
 * by deep link, by a notification tap, or by a session that was already open.
 *
 * A REQUIRED update has no dismiss. That is the point of it, and it is why the
 * floor should only ever be moved for something that genuinely cannot be left
 * running. An available update is a one-line prompt the user can decline.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { update, storeUrl } = useAppConfig();
  const [dismissed, setDismissed] = useState(false);

  function openStore() {
    haptic.tap();
    if (storeUrl) void Linking.openURL(storeUrl).catch(() => undefined);
  }

  if (update === 'required') {
    return (
      <Screen padded>
        <Animated.View entering={FadeIn.duration(240)} style={styles.blocking}>
          <View style={styles.badge}>
            <Ionicons name="arrow-up-circle" size={30} color={colors.brand.accent} />
          </View>
          <Text variant="title" style={styles.centred}>
            {t('update.requiredTitle')}
          </Text>
          <Text variant="body" tone="secondary" style={styles.centred}>
            {t('update.requiredBody')}
          </Text>
          <View style={styles.action}>
            <Button label={t('update.action')} onPress={openStore} size="lg" fullWidth />
          </View>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      {children}

      {update === 'available' && !dismissed && (
        <Animated.View entering={FadeIn.duration(200)} style={styles.toast}>
          <Column gap="xs" style={styles.toastBody}>
            <Text variant="bodyStrong">{t('update.availableTitle')}</Text>
            <Text variant="caption" tone="secondary">
              {t('update.availableBody')}
            </Text>
          </Column>
          <Column gap="xs">
            <Button label={t('update.action')} onPress={openStore} size="sm" />
            <Button
              label={t('update.later')}
              onPress={() => setDismissed(true)}
              variant="ghost"
              size="sm"
            />
          </Column>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  blocking: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.soft,
    marginBottom: spacing.md,
  },
  centred: { textAlign: 'center' },
  action: { alignSelf: 'stretch', marginTop: spacing.xl },
  toast: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xxxl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.bg.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
    shadowColor: colors.text.primary,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  toastBody: { flex: 1 },
});
