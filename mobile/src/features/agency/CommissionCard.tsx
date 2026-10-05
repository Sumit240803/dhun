import { StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useCommission } from '@/api/queries/useAgency';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatPoints } from '@/lib/money';
import { points as asPoints } from '@/lib/units';
import { colors, radius, spacing } from '@/theme';
import { Badge, Banner, Card, Column, Divider, Row, Skeleton, Text } from '@/ui';

/** Basis points as a percentage, without a trailing `.0` on whole numbers. */
function percent(rateBp: number): string {
  const value = rateBp / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * What this agent or agency earns.
 *
 * The one thing this screen exists to say: **the rate is already decided**.
 * It was set by last month's team total, it cannot move, and an agency can
 * quote it to a sub-agent today. Everything else — the volume building up, the
 * level it is heading for — is clearly marked as being about NEXT month, so
 * the two are never confused.
 */
export function CommissionCard({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  const commission = useCommission(visible);
  if (!visible) return null;

  return (
    <Animated.View entering={FadeInDown.duration(220)}>
      <Card>
        <Column gap="md">
          <Text variant="heading">{t('commission.title')}</Text>

          {commission.isError ? (
            <Banner
              message={errorMessage(commission.error)}
              onRetry={() => void commission.refetch()}
            />
          ) : commission.data === undefined ? (
            <Skeleton height={120} rounding="md" />
          ) : (
            <>
              <Column gap="xs" style={styles.rateBox}>
                <Text variant="micro" tone="faint">
                  {t('commission.thisPeriod')}
                </Text>
                {commission.data.current === null ? (
                  <Text variant="caption" tone="secondary">
                    {t('commission.noLevelYet')}
                  </Text>
                ) : (
                  <>
                    <Row gap="sm">
                      <Text variant="title" testID="commission-rate">
                        {t('commission.rate', { rate: percent(commission.data.current.rateBp) })}
                      </Text>
                      <Badge
                        label={t('commission.level', { level: commission.data.current.level })}
                        tone="brand"
                      />
                    </Row>
                    <Text variant="caption" tone="secondary">
                      {t('commission.fixedInAdvance')}
                    </Text>
                  </>
                )}
              </Column>

              <Divider />

              <Column gap="xs">
                <Text variant="micro" tone="faint">
                  {t('commission.earningTowards')}
                </Text>
                <Text variant="bodyStrong">
                  {t('commission.teamPoints', {
                    points: formatPoints(asPoints(commission.data.earningNow)),
                  })}
                </Text>
                {commission.data.projected !== null && (
                  <Text variant="caption" tone="secondary">
                    {t('commission.projected', {
                      level: commission.data.projected.level,
                      rate: percent(commission.data.projected.rateBp),
                    })}
                  </Text>
                )}
              </Column>

              <Divider />

              <Column gap="sm">
                <Text variant="micro" tone="faint">
                  {t('commission.historyTitle')}
                </Text>
                {commission.data.history.length === 0 ? (
                  <Text variant="caption" tone="secondary">
                    {t('commission.historyEmpty')}
                  </Text>
                ) : (
                  commission.data.history.map((row) => (
                    <Row key={row.period} justify="between" gap="md">
                      <Text variant="caption" tone="secondary">
                        {t('commission.historyRow', {
                          period: row.period,
                          rate: percent(row.rateBp),
                        })}
                      </Text>
                      <Text variant="caption">{formatPoints(asPoints(row.points))}</Text>
                    </Row>
                  ))
                )}
                <Text variant="micro" tone="faint">
                  {t('commission.heldNote')}
                </Text>
              </Column>
            </>
          )}
        </Column>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rateBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand.soft,
  },
});
