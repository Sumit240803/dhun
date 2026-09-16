import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import type { Cosmetic } from '@/api/types';
import { useTranslation } from '@/i18n';
import { colors, radius, spacing } from '@/theme';
import { Text } from '@/ui';
import { themed } from '@/visuals/look';
import { LookAvatar } from '@/visuals/LookAvatar';

/**
 * A cosmetic, shown as the thing itself rather than a picture of it.
 *
 * A frame is drawn around the viewer's own initial, a bubble holds a word, a
 * name colour colours a name. Every one of these is drawn from the same style
 * data the room uses, so what the store shows is exactly what a room will.
 */
export function ItemSwatch({ item, name }: { item: Cosmetic; name: string }) {
  const { t } = useTranslation();

  switch (item.kind) {
    case 'frame':
      return (
        <View style={styles.box}>
          <LookAvatar name={name} size="md" frame={{ asset: item.asset, style: item.style }} />
        </View>
      );

    case 'chat_bubble': {
      const bubble = themed(item.style);
      return (
        <View style={styles.box}>
          <View
            style={[
              styles.bubble,
              { backgroundColor: bubble.background, borderColor: bubble.border },
            ]}
          >
            <Text variant="caption" style={{ color: bubble.text }}>
              {t('store.sampleMessage')}
            </Text>
          </View>
        </View>
      );
    }

    case 'nickname_color':
      return (
        <View style={styles.box}>
          <Text variant="title" style={{ color: themed(item.style).color }}>
            Aa
          </Text>
        </View>
      );

    case 'entry_effect': {
      const accent = themed(item.style).accent;
      return (
        <View style={styles.box}>
          <LinearGradient
            colors={[accent, `${accent}33`]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.entry}
          >
            <Ionicons name="sparkles" size={18} color={colors.text.onMedia} />
          </LinearGradient>
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  // Fixed, so a grid of mixed swatches lines up.
  box: { height: 64, alignItems: 'center', justifyContent: 'center' },
  bubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.sm,
    borderWidth: 1.5,
  },
  entry: {
    width: 96,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: spacing.md,
  },
});
