import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/theme';

/**
 * The bar's own height, before the system inset is added.
 *
 * Android's default is cramped next to a gesture bar; iOS carries its home
 * indicator inside the inset rather than the bar.
 */
const BAR_HEIGHT = Platform.OS === 'ios' ? 56 : 60;

/**
 * How much vertical space the tab bar occupies, inset included.
 *
 * ONE source, used by three things that must agree: the bar's own style, the
 * bottom padding of every scrollable inside a tab, and the offset of anything
 * floating above it. When they disagree, either the last list row sits under
 * the bar forever or there is a strip of dead space beneath every screen.
 *
 * This matters more than it used to. Expo SDK 54 turned on edge-to-edge by
 * default on Android, so the app now draws UNDER the navigation bar: nothing
 * adds that space for you, and a bar with a hardcoded height renders with its
 * icons behind the system gesture pill.
 */
export function useTabBarHeight(): number {
  return BAR_HEIGHT + useSafeAreaInsets().bottom;
}

export { BAR_HEIGHT as tabBarBaseHeight };
