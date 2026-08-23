import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';

import { useTranslation, type MessageKey } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, spacing, typography } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Outline when idle, filled when active.
 *
 * Two weights rather than colour alone: on a cheap screen in a bright room the
 * brand rose and the inactive grey are not far enough apart to be certain which
 * tab you are on, and colour alone fails for a colour-blind user.
 */
const TABS: { name: string; label: MessageKey; icon: IconName; active: IconName }[] = [
  { name: 'index', label: 'tabs.live', icon: 'radio-outline', active: 'radio' },
  { name: 'following', label: 'tabs.following', icon: 'heart-outline', active: 'heart' },
  { name: 'search', label: 'tabs.search', icon: 'search-outline', active: 'search' },
  { name: 'wallet', label: 'tabs.wallet', icon: 'wallet-outline', active: 'wallet' },
  { name: 'me', label: 'tabs.me', icon: 'person-outline', active: 'person' },
];

export default function TabsLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        tabBarActiveTintColor: colors.brand.solid,
        tabBarInactiveTintColor: colors.text.faint,
        // The bar sits over video on the Live tab. Without this the screen
        // renders behind an opaque strip on Android and the host's feet vanish.
        tabBarHideOnKeyboard: true,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.label),
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons name={focused ? tab.active : tab.icon} size={size} color={color} />
            ),
          }}
          listeners={{
            // Selection, not impact: switching tabs is a choice, and an impact
            // buzz five times a minute is the kind of thing people turn off.
            tabPress: () => haptic.selection(),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.bg.surface,
    borderTopColor: colors.border.subtle,
    borderTopWidth: StyleSheet.hairlineWidth,
    // React Navigation already adds the bottom inset; this is the bar's own
    // height above it. Android's default is cramped next to the gesture bar.
    height: Platform.OS === 'ios' ? 84 : 64,
    paddingTop: spacing.xs,
  },
  item: { paddingVertical: spacing.xs },
  label: { ...typography.micro, marginTop: 2 },
});
