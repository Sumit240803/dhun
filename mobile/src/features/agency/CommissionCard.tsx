import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useCommission } from '@/api/queries/useAgency';
import type { CommissionSummary } from '@/api/types';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatPoints } from '@/lib/money';
import { points as asPoints } from '@/lib/units';
import { colors, radius } from '@/theme';
import { Banner, Card, Column, Divider, Row, Skeleton, Text } from '@/ui';

import { CardTitle, Meter } from './parts';

/** Basis points as a percentage, without a trailing `.0` on whole numbers. */
function percent(rateBp: number): string {
  const value = rateBp / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * The five bands share the gift-tier ramp — grey, blue, purple, orange, gold.
 *
 * Deliberately the same ladder as gifts and user levels: a person learns the
 * hierarchy once and it reads the same everywhere. The ramp is indexed by
 * POSITION in the ladder rather than by name, so renaming D/C/B/A/S in config
 * changes nothing here.
 */
function rungColour(index: number, total: number): string {
  const step = Math.min(5, Math.max(1, Math.round(((index + 1) / total) * 5)));
  return colors.tier[step as 1 | 2 | 3 | 4 | 5];
}

/**
 * What this agent or agency earns.
 *
 * The screen it replaced said "4% of your team's earnings — set by last
 * month's team total, so it will not change", and you had to read all of it to
 * learn one number. This shows the rate as the number it is, the ladder as a
 * ladder, and the distance to the next rung as a bar with a figure on it.
 *
 * Two facts that must never blur into each other: THIS month's rate is already
 * fixed and cannot move, while the volume building up decides NEXT month's.
 * They are separated by a divider and labelled by period for exactly that
 * reason.
 */
export function CommissionCard({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  const commission = useCommission(visible);
  if (!visible) return null;

  return (
    <Animated.View entering={FadeInDown.duration(220)}>
      <Card>
        <Column gap="lg">
          <CardTitle icon="trending-up" title={t('commission.title')} />

          {commission.isError ? (
            <Banner
              message={errorMessage(commission.error)}
              onRetry={() => void commission.refetch()}
            />
          ) : commission.data === undefined ? (
            <Column gap="md">
              <Skeleton height={92} rounding="lg" />
              <Skeleton height={64} rounding="md" />
            </Column>
          ) : (
            <CommissionBody data={commission.data} />
          )}
        </Column>
      </Card>
    </Animated.View>
  );
}

function CommissionBody({ data }: { data: CommissionSummary }) {
  const { t } = useTranslation();
  const ladder = data.ladder ?? [];
  const activeLevel = data.current?.level ?? ladder[0]?.level;
  const activeIndex = ladder.findIndex((band) => band.level === activeLevel);
  const activeColour = activeIndex >= 0 ? rungColour(activeIndex, ladder.length) : colors.tier[1];

  return (
    <>
      {/* This month — already decided. The rate is the subject of the card. */}
      <Column gap="sm">
        <Text variant="micro" tone="faint">
          {t('commission.thisPeriod')}
        </Text>
        <Row gap="md">
          <View style={[styles.levelBadge, { backgroundColor: activeColour }]}>
            <Text variant="title" tone="onBrand">
              {activeLevel ?? '—'}
            </Text>
          </View>
          <Column gap="xs" flex={1}>
            <Row gap="xs" align="baseline">
              <Text variant="display" testID="commission-rate">
                {data.current === null ? '—' : percent(data.current.rateBp)}
              </Text>
              <Text variant="title" tone="secondary">
                %
              </Text>
            </Row>
            <Text variant="caption" tone="secondary">
              {data.current === null ? t('commission.noLevelYet') : t('commission.ofTeamEarnings')}
            </Text>
          </Column>
        </Row>
      </Column>

      <Divider />

      {/* Next month — the ladder, and how far up it this volume reaches. */}
      <Column gap="md">
        <Row justify="between" align="baseline">
          <Text variant="micro" tone="faint">
            {t('commission.earningTowards')}
          </Text>
          <Text variant="bodyStrong" style={{ color: colors.currency.point }}>
            {formatPoints(asPoints(data.earningNow))}
          </Text>
        </Row>

        <Ladder data={data} />

        {data.nextLevel !== null ? (
          <Text variant="caption" tone="secondary">
            {t('commission.toNextLevel', {
              points: formatPoints(asPoints(data.nextLevel.pointsNeeded)),
              level: data.nextLevel.level,
              rate: percent(data.nextLevel.rateBp),
            })}
          </Text>
        ) : (
          <Text variant="caption" tone="secondary">
            {t('commission.topLevel')}
          </Text>
        )}
      </Column>

      {data.history.length > 0 && (
        <>
          <Divider />
          <Column gap="sm">
            <Text variant="micro" tone="faint">
              {t('commission.historyTitle')}
            </Text>
            {data.history.slice(0, 3).map((row) => (
              <Row key={row.period} justify="between">
                <Text variant="caption" tone="secondary">
                  {t('commission.historyRow', { period: row.period, rate: percent(row.rateBp) })}
                </Text>
                <Text variant="caption" style={{ color: colors.currency.point }}>
                  {formatPoints(asPoints(row.points))}
                </Text>
              </Row>
            ))}
          </Column>
        </>
      )}

      <Text variant="micro" tone="faint">
        {t('commission.heldNote')}
      </Text>
    </>
  );
}

/**
 * The five rungs, with the band this volume currently reaches filled in.
 *
 * Each rung carries a meter of its own rather than one bar across the whole
 * ladder, because the bands are not evenly spaced — D to C is 2M points and A
 * to S is 100M. One continuous bar would make the first rung look like a
 * rounding error and the last like most of the journey.
 */
function Ladder({ data }: { data: CommissionSummary }) {
  const ladder = data.ladder ?? [];
  if (ladder.length === 0) return null;

  const reachedIndex = ladder.reduce(
    (best, band, index) => (data.earningNow >= band.minPoints ? index : best),
    0,
  );

  return (
    <Row gap="xs" align="end">
      {ladder.map((band, index) => {
        const colour = rungColour(index, ladder.length);
        const reached = index <= reachedIndex;
        const next = ladder[index + 1];
        // How far INTO this band the volume has come. The band being worked on
        // is partly full; everything below it is complete.
        // The top rung has no band above it, so it is given a notional span of
        // its own width — enough for the bar to fill as volume climbs past it.
        const span = (next?.minPoints ?? Math.max(band.minPoints * 2, 1)) - band.minPoints;
        const into = (data.earningNow - band.minPoints) / (span || 1);
        const fill = index < reachedIndex ? 1 : index === reachedIndex ? into : 0;

        return (
          <Column key={band.level} gap="xs" flex={1} align="center">
            <Text variant="micro" style={{ color: reached ? colour : colors.text.faint }}>
              {band.level}
            </Text>
            <Meter progress={fill} colour={colour} height={6} />
          </Column>
        );
      })}
    </Row>
  );
}

const styles = StyleSheet.create({
  levelBadge: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
