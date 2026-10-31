import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { REACTIONS, type Reaction } from '@/api/types';
import { useTranslation } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors, radius, spacing } from '@/theme';
import { Row, Text } from '@/ui';
import { REACTION_GLYPHS } from './ReactionLayer';

/** What the mic button is offering right now. */
export type MicMode =
  /** On a seat and able to toggle. */
  | 'live'
  /** Asked, waiting for the host. */
  | 'pending'
  /** Could ask. */
  | 'request'
  /** No seats in this room, or we are not allowed to ask. */
  | 'none';

interface Props {
  canSend: boolean;
  canGift: boolean;
  micMode: MicMode;
  micOn: boolean;
  /** Host mute, which our own button must not pretend to undo. */
  micBlocked: boolean;
  showCamera: boolean;
  cameraOn: boolean;
  onSend: (body: string) => void;
  onMicPress: () => void;
  onCameraPress: () => void;
  onFeaturesPress: () => void;
  onGiftPress: () => void;
  /** Absent for guests — reacting is for accounts, like chat. */
  onReact?: (emoji: Reaction) => void;
}

/**
 * Quick replies.
 *
 * Straight from the references, which put `Hi there!` / `Plz Follow` / `LOL~`
 * above the keyboard. They exist because typing Hindi or Hinglish on a phone
 * keyboard in a fast-moving room is slow enough that most people say nothing at
 * all, and a room where the audience is silent does not convert to gifts.
 *
 * Translated like everything else — `hi.ts` carries the Hindi versions rather
 * than romanised English.
 */
const QUICK_REPLY_KEYS = [
  'room.quickHello',
  'room.quickFollow',
  'room.quickNice',
  'room.quickLol',
  'room.quickSeat',
] as const;

/**
 * The bottom bar: say something, take the mic, open the gifts.
 *
 * ── Why the composer is always a field and never a button ───────────────────
 *
 * Our room used to show `Follow +` here and hide the composer behind a tab. The
 * references always show an open field, because the bar is the room's call to
 * action and "say something" is the cheapest thing anyone can be asked to do.
 * The quick replies sit above it the moment it is focused.
 *
 * ── The gift button is last, biggest and never moves ────────────────────────
 *
 * It is the only control on this screen that takes money. Everything else may
 * come and go with the room type; it stays in the same place so it can be hit
 * without looking, mid-combo.
 */
export function RoomComposer({
  canSend,
  canGift,
  micMode,
  micOn,
  micBlocked,
  showCamera,
  cameraOn,
  onSend,
  onMicPress,
  onCameraPress,
  onFeaturesPress,
  onGiftPress,
  onReact,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [picker, setPicker] = useState(false);

  function react(emoji: Reaction) {
    haptic.selection();
    onReact?.(emoji);
    setPicker(false);
  }

  function send(body: string) {
    const trimmed = body.trim();
    if (trimmed === '' || !canSend) return;
    haptic.tap();
    onSend(trimmed);
    setDraft('');
  }

  return (
    <View style={styles.root}>
      {focused && (
        <Animated.View entering={FadeInDown.duration(160)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quick}
            keyboardShouldPersistTaps="always"
          >
            {QUICK_REPLY_KEYS.map((key) => (
              <Pressable
                key={key}
                onPress={() => send(t(key))}
                accessibilityRole="button"
                style={styles.quickChip}
                testID={`quick-${key}`}
              >
                <Text variant="micro" tone="onMedia">
                  {t(key)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
      )}

      {picker && onReact && (
        <Animated.View entering={FadeInDown.duration(140)} style={styles.picker}>
          {REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => react(emoji)}
              accessibilityRole="button"
              accessibilityLabel={emoji}
              style={({ pressed }) => [styles.pickerItem, pressed && styles.pickerPressed]}
              testID={`react-${emoji}`}
            >
              <Text style={styles.pickerGlyph}>{REACTION_GLYPHS[emoji]}</Text>
            </Pressable>
          ))}
        </Animated.View>
      )}

      <Row gap="sm" align="center" style={styles.bar}>
        <View style={styles.field}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={() => send(draft)}
            placeholder={canSend ? t('room.chatPlaceholder') : t('room.chatOffline')}
            placeholderTextColor={colors.text.onMedia}
            editable={canSend}
            maxLength={500}
            returnKeyType="send"
            blurOnSubmit={false}
            style={styles.input}
            accessibilityLabel={t('room.chatPlaceholder')}
            testID="room-composer"
          />
        </View>

        {micMode !== 'none' && (
          <BarButton
            icon={micMode === 'pending' ? 'hourglass' : micOn && !micBlocked ? 'mic' : 'mic-off'}
            label={
              micMode === 'pending'
                ? t('room.handRaised')
                : micMode === 'request'
                  ? t('room.raiseHand')
                  : micOn
                    ? t('room.micOn')
                    : t('room.micOff')
            }
            active={micMode === 'live' && micOn && !micBlocked}
            warn={micMode === 'pending'}
            onPress={onMicPress}
            testID="room-mic"
          />
        )}

        {showCamera && (
          <BarButton
            icon={cameraOn ? 'videocam' : 'videocam-off'}
            label={cameraOn ? t('room.cameraOn') : t('room.cameraOff')}
            active={cameraOn}
            onPress={onCameraPress}
            testID="room-camera"
          />
        )}

        <BarButton
          icon="grid"
          label={t('room.features')}
          onPress={onFeaturesPress}
          testID="room-features"
        />

        {/* Tap: a heart. Hold: the six. The commonest reaction is one tap away
            and the rest are one gesture further, never a menu. */}
        {onReact && (
          <Pressable
            onPress={() => react('heart')}
            onLongPress={() => {
              haptic.selection();
              setPicker((open) => !open);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('room.react')}
            style={({ pressed }) => [styles.react, pressed && styles.reactPressed]}
            testID="room-react"
          >
            <Ionicons name="heart" size={20} color={colors.text.onMedia} />
          </Pressable>
        )}

        {canGift && (
          <Pressable
            onPress={() => {
              haptic.tap();
              onGiftPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={t('gifting.open')}
            style={({ pressed }) => [styles.gift, pressed && styles.giftPressed]}
            testID="room-gift"
          >
            <Ionicons name="gift" size={22} color={colors.text.onBrand} />
          </Pressable>
        )}
      </Row>
    </View>
  );
}

function BarButton({
  icon,
  label,
  active,
  warn,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  warn?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.barButton, active && styles.barButtonActive, warn && styles.barButtonWarn]}
      testID={testID}
    >
      <Ionicons name={icon} size={18} color={active ? colors.text.onBrand : colors.text.onMedia} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  react: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass.fillStrong,
  },
  reactPressed: { opacity: 0.7 },
  picker: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    gap: spacing.xs,
    padding: spacing.xs,
    marginBottom: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.glass.scrim,
  },
  pickerItem: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerPressed: { backgroundColor: colors.glass.fillStrong },
  pickerGlyph: { fontSize: 22, lineHeight: 26 },
  root: { gap: spacing.xs },
  quick: { gap: spacing.xs, paddingHorizontal: spacing.sm },
  quickChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
  },
  bar: { paddingHorizontal: spacing.sm },
  field: { flex: 1 },
  input: {
    height: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.videoScrim,
    color: colors.text.onMedia,
    fontSize: 13,
  },
  barButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.videoScrim,
  },
  barButtonActive: { backgroundColor: colors.brand.solid },
  barButtonWarn: { backgroundColor: colors.status.warning },
  gift: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.solid,
  },
  giftPressed: { backgroundColor: colors.brand.pressed },
});
