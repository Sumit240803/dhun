// Haptic feedback.
//
// Wrapped rather than called directly for three reasons: every call is
// fire-and-forget (a device with no taptic engine rejects the promise, and a
// missed vibration must never surface as an error), web has no haptics at all,
// and naming them by INTENT rather than by waveform is what stops the app
// buzzing inconsistently across forty screens.
//
// Rule of thumb: haptics mark a COMMIT, not a movement. Selection when a choice
// is made, success when a step completes, error when one is rejected. Never on
// scroll, never per keystroke — constant buzzing reads as a broken phone.

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

function fire(run: () => Promise<void>): void {
  if (!supported) return;
  void run().catch(() => undefined);
}

export const haptic = {
  /** A choice was registered: a tab, a chip, a filled OTP box. */
  selection: () => fire(() => Haptics.selectionAsync()),

  /** A step completed: signed in, profile saved, gift sent. */
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  /** The action went through but something needs attention. */
  warning: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),

  /** Rejected: wrong code, failed validation, declined payment. */
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),

  /** A primary button being pressed. Light — this one fires often. */
  tap: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
