import { Ionicons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTranslation, type MessageKey } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Column, Sheet, Text, type SheetHandle } from '@/ui';

export type RoomFeature =
  'leaderboard' | 'share' | 'report' | 'rules' | 'rewards' | 'store' | 'cosmetics' | 'minimise';

interface Entry {
  id: RoomFeature;
  icon: keyof typeof Ionicons.glyphMap;
  label: MessageKey;
  /** Greyed with a "coming soon" note rather than hidden. See below. */
  ready: boolean;
}

/**
 * The grid behind the ⌘ button.
 *
 * ── Why unbuilt tiles are shown and disabled, not hidden ────────────────────
 *
 * The references carry eight: Rank, Rewards, Store, VIP, Gift Center, Bag,
 * Gift Gallery, Gift Collection. Several of ours do not exist yet — VIP is
 * unbuilt, and so is the gift gallery.
 *
 * A hidden tile teaches nothing and reappearing later looks like a bug. A
 * disabled one with a label says what the room will eventually do, which is
 * what a host asks about and what makes the grid worth opening twice. It is
 * also honest: the person can see there is nothing behind it yet.
 */
const FEATURES: Entry[] = [
  { id: 'leaderboard', icon: 'trophy', label: 'room.featureRank', ready: true },
  { id: 'rewards', icon: 'gift-outline', label: 'room.featureRewards', ready: true },
  { id: 'store', icon: 'card', label: 'room.featureStore', ready: true },
  { id: 'cosmetics', icon: 'color-palette', label: 'room.featureCosmetics', ready: true },
  { id: 'share', icon: 'share-social', label: 'room.featureShare', ready: false },
  { id: 'report', icon: 'flag', label: 'room.featureReport', ready: true },
  { id: 'rules', icon: 'document-text', label: 'room.featureRules', ready: true },
  { id: 'minimise', icon: 'contract', label: 'room.featureMinimise', ready: false },
];

interface Props {
  onSelect: (feature: RoomFeature) => void;
}

export const FeaturesSheet = forwardRef<SheetHandle, Props>(function FeaturesSheet(
  { onSelect },
  ref,
) {
  const { t } = useTranslation();

  return (
    <Sheet ref={ref} title={t('room.features')}>
      <View style={styles.grid}>
        {FEATURES.map((entry) => (
          <Pressable
            key={entry.id}
            onPress={() => {
              if (!entry.ready) return;
              haptic.selection();
              onSelect(entry.id);
            }}
            disabled={!entry.ready}
            accessibilityRole="button"
            accessibilityState={{ disabled: !entry.ready }}
            accessibilityLabel={t(entry.label)}
            style={styles.cell}
            testID={`feature-${entry.id}`}
          >
            <Column gap="xs" align="center">
              <View style={[styles.icon, !entry.ready && styles.iconDisabled]}>
                <Ionicons
                  name={entry.icon}
                  size={22}
                  color={entry.ready ? colors.text.onBrand : colors.text.faint}
                />
              </View>
              <Text variant="micro" tone={entry.ready ? 'secondary' : 'faint'} numberOfLines={1}>
                {t(entry.label)}
              </Text>
              {!entry.ready && (
                <Text variant="micro" tone="faint" style={styles.soon}>
                  {t('common.comingSoon')}
                </Text>
              )}
            </Column>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
  },
  // Four across, as the references lay them out — two rows of four reads as a
  // menu, where three rows of three reads as a keypad.
  cell: { width: '25%', alignItems: 'center' },
  icon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.solid,
  },
  iconDisabled: { backgroundColor: colors.bg.raised },
  soon: { fontSize: 8, lineHeight: 10 },
});
