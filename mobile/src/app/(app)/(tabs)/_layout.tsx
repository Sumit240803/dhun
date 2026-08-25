import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMessageThreads } from '@/api/queries/useFeed';
import { useTranslation, type MessageKey } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing, typography } from '@/theme';
import { Text, tabBarBaseHeight } from '@/ui';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Outline when idle, filled when active.
 *
 * Two weights rather than colour alone: on a cheap screen in a bright room the
 * brand rose and the inactive grey are not far enough apart to be certain which
 * tab you are on, and colour alone fails for a colour-blind user.
 */
const TABS: { name: string; label: MessageKey; icon: IconName; active: IconName }[] = [
  { name: 'index', label: 'tabs.live', icon: 'videocam-outline', active: 'videocam' },
  { name: 'party', label: 'feed.party', icon: 'people-outline', active: 'people' },
  { name: 'discover', label: 'tabs.search', icon: 'planet-outline', active: 'planet' },
  { name: 'messages', label: 'messages.title', icon: 'chatbubble-outline', active: 'chatbubble' },
  { name: 'me', label: 'tabs.me', icon: 'person-outline', active: 'person' },
];

export default function TabsLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // The unread count belongs on the tab, not only inside the screen — it is the
  // reason someone opens the app at all, and it has to survive being on another
  // tab. Reads the same query the Messages screen does, so it cannot disagree.
  const threads = useMessageThreads('all');
  const unread = (threads.data ?? []).reduce((sum, thread) => sum + thread.unread, 0);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Height and padding both carry the inset. Expo SDK 54 turned on
        // edge-to-edge by default on Android, so the app draws UNDER the
        // navigation bar and nothing reserves that space for you.
        tabBarStyle: [
          styles.bar,
          { height: tabBarBaseHeight + insets.bottom, paddingBottom: insets.bottom },
        ],
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        tabBarActiveTintColor: colors.brand.solid,
        tabBarInactiveTintColor: colors.text.faint,
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
              <View>
                <Ionicons name={focused ? tab.active : tab.icon} size={size} color={color} />
                {tab.name === 'messages' && unread > 0 && (
                  <View style={styles.badge}>
                    <Text variant="micro" tone="onMedia">
                      {unread > 99 ? '99+' : String(unread)}
                    </Text>
                  </View>
                )}
              </View>
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
    paddingTop: spacing.xs,
  },
  item: { paddingVertical: spacing.xs },
  label: { ...typography.micro, marginTop: 2 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.status.live,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
