import { Platform } from 'react-native';

/**
 * The tab bar's own height, BEFORE the system inset.
 *
 * Used in exactly one place — the tabs layout, which adds `insets.bottom` to it
 * for both height and paddingBottom. Expo SDK 54 turned edge-to-edge on by
 * default for Android, so the app draws under the navigation bar and nothing
 * reserves that space for you.
 *
 * ⛔ A SCREEN INSIDE THE TABS MUST NOT ADD THIS TO ANYTHING.
 *
 * React Navigation lays the screen container and the bar out as siblings in a
 * column, so a tab screen's box already ENDS where the bar begins. Padding a
 * list or offsetting a floating button by the bar height double-counts it — the
 * first version of this file exported a `useTabBarHeight()` hook and the Go Live
 * button floated a third of the way up the feed.
 *
 * Screens need clearance for the FLOATING BUTTON, which is a different and much
 * smaller number, and that is what `fabClearance` is.
 */
export const tabBarBaseHeight = Platform.OS === 'ios' ? 56 : 60;

/** Bottom padding a scrollable needs so its last row clears a floating button. */
export const fabClearance = 48 + 16 * 2;
