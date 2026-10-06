import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import { Avatar, Column, Row, Text } from '@/ui';

import { personName } from './format';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * The visual vocabulary of the agency screens.
 *
 * These screens were a wall of sentences — a rate, a level and a deadline all
 * written out as prose that had to be READ to be understood. Everything here
 * exists to make the same facts legible at a glance: a number big enough to be
 * the subject, a bar you can see the length of, a face instead of a name.
 */

/** One number, large, with its label underneath. The unit of every summary row. */
export function Stat({
  value,
  label,
  tone = 'primary',
  icon,
}: {
  value: string;
  label: string;
  tone?: 'primary' | 'coin' | 'point';
  icon?: IconName;
}) {
  const colour =
    tone === 'coin'
      ? colors.currency.coin
      : tone === 'point'
        ? colors.currency.point
        : colors.text.primary;

  return (
    <Column gap="xs" flex={1} align="center">
      {icon !== undefined && <Ionicons name={icon} size={18} color={colour} />}
      <Text variant="title" style={{ color: colour }} numberOfLines={1}>
        {value}
      </Text>
      <Text variant="micro" tone="faint" numberOfLines={1}>
        {label}
      </Text>
    </Column>
  );
}

/** Three stats across, divided — a header strip rather than three sentences. */
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <Row style={styles.statRow} align="start">
      {children}
    </Row>
  );
}

/**
 * A horizontal bar with a filled portion.
 *
 * `progress` is clamped, because a server that reports more than the top band
 * would otherwise draw a bar wider than its own track.
 */
export function Meter({
  progress,
  colour = colors.brand.solid,
  height = 10,
}: {
  progress: number;
  colour?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return (
    <View
      style={[styles.meterTrack, { height, borderRadius: height / 2 }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: colour,
        }}
      />
    </View>
  );
}

/** A small filled label. Unlike Chip it is not tappable — it states a fact. */
export function Tag({
  label,
  colour,
  soft,
  icon,
}: {
  label: string;
  colour: string;
  soft: string;
  icon?: IconName;
}) {
  return (
    <Row gap="xs" style={[styles.tag, { backgroundColor: soft }]}>
      {icon !== undefined && <Ionicons name={icon} size={12} color={colour} />}
      <Text variant="micro" style={{ color: colour }}>
        {label}
      </Text>
    </Row>
  );
}

/**
 * A person, as a face and a name rather than a line of text.
 *
 * Nobody in the agency tree has an avatar image yet, so every one of these
 * draws an initial — which is still an anchor the eye can scan a list by, and
 * becomes a real face the moment profile pictures exist.
 */
export function PersonRow({
  person,
  subtitle,
  tags,
  right,
  style,
}: {
  person: { displayName: string | null; publicId: number };
  subtitle?: string;
  tags?: React.ReactNode;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const name = personName(person);
  return (
    <Row gap="md" style={style}>
      <Avatar name={name} size="md" />
      <Column gap="xs" flex={1}>
        <Row gap="sm" wrap>
          <Text variant="bodyStrong" numberOfLines={1}>
            {name}
          </Text>
          {tags}
        </Row>
        {subtitle !== undefined && (
          <Text variant="micro" tone="faint" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </Column>
      {right}
    </Row>
  );
}

/** A heading with an icon, so a card announces itself before it is read. */
export function CardTitle({
  icon,
  title,
  colour = colors.text.secondary,
  right,
}: {
  icon: IconName;
  title: string;
  colour?: string;
  right?: React.ReactNode;
}) {
  return (
    <Row gap="sm">
      <Ionicons name={icon} size={18} color={colour} />
      <Text variant="heading" style={styles.grow}>
        {title}
      </Text>
      {right}
    </Row>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  statRow: {
    paddingVertical: spacing.sm,
  },
  meterTrack: {
    width: '100%',
    backgroundColor: colors.bg.raised,
    overflow: 'hidden',
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
});
