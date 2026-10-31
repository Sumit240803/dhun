import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { MiniRoomPlayer } from '@/features/room/chrome/MiniRoomPlayer';
import { colors } from '@/theme';

export default function AppLayout() {
  return (
    <View style={styles.fill}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg.base },
        }}
      />
      {/* A minimised room keeps playing under whatever screen is open. */}
      <MiniRoomPlayer />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
