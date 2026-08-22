import { Tabs } from 'expo-router';

import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg.surface,
          borderTopColor: colors.border.subtle,
        },
        tabBarActiveTintColor: colors.brand.solid,
        tabBarInactiveTintColor: colors.text.faint,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Live' }} />
      <Tabs.Screen name="following" options={{ title: 'Following' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet' }} />
      <Tabs.Screen name="me" options={{ title: 'Me' }} />
    </Tabs>
  );
}
