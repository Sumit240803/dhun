// The selfie, before it is sent.
//
// A portrait frame at the proportion the reviewer sees, so what the host
// takes is what gets judged. Empty, it invites; filled, it shows the photo
// with a way to retake — a host who looks at it and thinks "that is not my
// best light" should be able to act on that before a reviewer does.

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useTranslation } from '@/i18n';
import { colors, radius, spacing } from '@/theme';
import { Row, Text } from '@/ui';

export function SelfieFrame({
  uri,
  busy,
  disabled,
  onPress,
}: {
  uri: string | null;
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={busy || disabled}
        accessibilityRole="button"
        accessibilityLabel={uri === null ? t('verification.takeSelfie') : t('verification.retake')}
        accessibilityState={{ busy, disabled }}
        style={({ pressed }) => [
          styles.frame,
          uri === null && styles.frameEmpty,
          pressed && styles.pressed,
        ]}
        testID="selfie-frame"
      >
        {uri !== null && (
          <Animated.View entering={FadeIn.duration(200)} style={StyleSheet.absoluteFill}>
            <Image source={{ uri }} style={styles.image} contentFit="cover" />
          </Animated.View>
        )}

        {busy ? (
          <ActivityIndicator color={colors.brand.accent} />
        ) : uri === null ? (
          <View style={styles.empty}>
            <View style={styles.cameraDisc}>
              <Ionicons name="camera" size={26} color={colors.brand.accent} />
            </View>
            <Text variant="bodyStrong">{t('verification.takeSelfie')}</Text>
            <Text variant="caption" tone="secondary" style={styles.centred}>
              {t('verification.faceHint')}
            </Text>
          </View>
        ) : (
          <View style={styles.retake}>
            <Ionicons name="camera" size={14} color={colors.text.onMedia} />
            <Text variant="micro" tone="onMedia">
              {t('verification.retake')}
            </Text>
          </View>
        )}
      </Pressable>

      {/* The three things a rejection is almost always about. */}
      <Row gap="lg" justify="center">
        <Tip icon="sunny-outline" label={t('verification.tipLight')} />
        <Tip icon="happy-outline" label={t('verification.tipFace')} />
        <Tip icon="person-outline" label={t('verification.tipAlone')} />
      </Row>
    </View>
  );
}

function Tip({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <Row gap="xs">
      <Ionicons name={icon} size={14} color={colors.text.faint} />
      <Text variant="micro" tone="faint">
        {label}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  frame: {
    alignSelf: 'center',
    width: 210,
    aspectRatio: 3 / 4,
    borderRadius: radius.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
  },
  frameEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border.strong,
  },
  pressed: { opacity: 0.85 },
  image: { width: '100%', height: '100%' },
  empty: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  cameraDisc: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.soft,
    marginBottom: spacing.xs,
  },
  centred: { textAlign: 'center' },
  retake: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.glass.scrim,
  },
});
