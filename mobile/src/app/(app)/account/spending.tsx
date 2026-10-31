import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { useSetSpendControls, useSpendStatus } from '@/api/queries/useSocial';
import type { SpendExclusion, SpendStatus } from '@/api/types';
import {
  capIssues,
  draftFrom,
  parseCap,
  raisesCap,
  type CapIssue,
  type SpendDraft,
} from '@/features/account/spending';
import { useTranslation, type MessageKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins } from '@/lib/money';
import { coins } from '@/lib/units';
import { colors, radius, spacing } from '@/theme';
import {
  Banner,
  Button,
  Card,
  Column,
  Input,
  Row,
  Screen,
  Sheet,
  Skeleton,
  Text,
  type SheetHandle,
} from '@/ui';

const ISSUE_KEYS: Record<CapIssue, MessageKey> = {
  notANumber: 'spending.issueNotANumber',
  tooSmall: 'spending.issueTooSmall',
  dailyAboveMonthly: 'spending.issueDailyAboveMonthly',
};

const PAUSE_OPTIONS: { value: SpendExclusion; label: MessageKey }[] = [
  { value: 'none', label: 'spending.pauseNone' },
  { value: '30d', label: 'spending.pause30' },
  { value: '90d', label: 'spending.pause90' },
  { value: 'permanent', label: 'spending.pauseForever' },
];

/**
 * Spending limits — trust-and-safety-v1 § financial harm.
 *
 * What was spent on gifts today and this month, then the two limits, then the
 * pause. Three rules the screen explains before the server enforces them: a
 * limit lowers at once and raises after a day; a pause cannot be shortened
 * while it runs; a permanent pause cannot be lifted from the app at all.
 * Permanent therefore goes through a confirmation sheet — the only one on this
 * screen — because it is the one choice here that cannot be taken back.
 */
export default function SpendingScreen() {
  const { t } = useTranslation();
  const status = useSpendStatus();
  const save = useSetSpendControls();
  const confirm = useRef<SheetHandle>(null);

  const [draft, setDraft] = useState<SpendDraft | null>(null);
  const [saved, setSaved] = useState(false);

  // Seeded once from the server, during render (React's "adjust state when a
  // prop changes" pattern). Not re-seeded on every refetch: that would
  // overwrite what the user is typing.
  if (draft === null && status.data !== undefined) setDraft(draftFrom(status.data));

  const data = status.data;
  const issues = draft ? capIssues(draft) : {};
  const dirty =
    draft !== null &&
    data !== undefined &&
    JSON.stringify(draft) !== JSON.stringify(draftFrom(data));
  const canSave = dirty && Object.keys(issues).length === 0 && !save.isPending;

  const nextDaily = draft ? parseCap(draft.daily) : null;
  const nextMonthly = draft ? parseCap(draft.monthly) : null;
  const willDelay =
    data !== undefined &&
    draft !== null &&
    Object.keys(issues).length === 0 &&
    (raisesCap(data.dailyCapCoins, nextDaily) || raisesCap(data.monthlyCapCoins, nextMonthly));

  async function submit() {
    if (!draft || !canSave) return;
    haptic.tap();
    setSaved(false);
    try {
      const next = await save.mutateAsync({
        dailyCapCoins: Number.isNaN(nextDaily) ? null : nextDaily,
        monthlyCapCoins: Number.isNaN(nextMonthly) ? null : nextMonthly,
        exclusion: draft.exclusion ?? undefined,
      });
      setDraft(draftFrom(next.spend));
      setSaved(true);
      haptic.success();
    } catch {
      haptic.error();
    }
  }

  function choosePause(value: SpendExclusion) {
    if (!draft) return;
    haptic.selection();
    if (value === 'permanent') {
      confirm.current?.present();
      return;
    }
    setDraft({ ...draft, exclusion: value });
  }

  return (
    <Screen padded={false} edges={['top', 'bottom']}>
      <Row style={styles.header} gap="md">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={spacing.md}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text.primary} />
        </Pressable>
        <Text variant="heading">{t('spending.title')}</Text>
      </Row>

      {status.isError ? (
        <View style={styles.gutter}>
          <Banner message={errorMessage(status.error)} onRetry={() => void status.refetch()} />
        </View>
      ) : data === undefined || draft === null ? (
        <Column gap="lg" style={styles.gutter}>
          <Skeleton height={96} rounding="lg" />
          <Skeleton height={180} rounding="lg" />
          <Skeleton height={120} rounding="lg" />
        </Column>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={FadeInDown.duration(240)}>
            <Text variant="body" tone="secondary">
              {t('spending.intro')}
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(240).delay(40)}>
            <Card>
              <Row gap="lg">
                <Spent
                  label={t('spending.today')}
                  value={formatCoins(coins(data.todayCoins))}
                  cap={data.dailyCapCoins}
                  capLabel={t}
                />
                <Spent
                  label={t('spending.thisMonth')}
                  value={formatCoins(coins(data.monthCoins))}
                  cap={data.monthlyCapCoins}
                  capLabel={t}
                />
              </Row>
              {data.coolingOff && (
                <Row gap="sm" align="center" style={styles.coolingOff}>
                  <Ionicons name="warning" size={16} color={colors.status.warning} />
                  <Text variant="caption" tone="secondary" style={styles.flex}>
                    {t('spending.coolingOff', {
                      coins: formatCoins(coins(data.coolingOffAtCoins)),
                    })}
                  </Text>
                </Row>
              )}
            </Card>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(240).delay(80)}>
            <Column gap="md">
              <Text variant="bodyStrong">{t('spending.limitsTitle')}</Text>
              <Input
                label={t('spending.dailyLabel')}
                value={draft.daily}
                onChangeText={(text) => {
                  setSaved(false);
                  setDraft({ ...draft, daily: text });
                }}
                keyboardType="number-pad"
                inputMode="numeric"
                placeholder={t('spending.noLimit')}
                error={issues.daily ? t(ISSUE_KEYS[issues.daily]) : undefined}
                helper={t('spending.coinsHelper')}
                testID="spending-daily"
              />
              <Input
                label={t('spending.monthlyLabel')}
                value={draft.monthly}
                onChangeText={(text) => {
                  setSaved(false);
                  setDraft({ ...draft, monthly: text });
                }}
                keyboardType="number-pad"
                inputMode="numeric"
                placeholder={t('spending.noLimit')}
                error={issues.monthly ? t(ISSUE_KEYS[issues.monthly]) : undefined}
                testID="spending-monthly"
              />
              {data.pending !== null && (
                <Row gap="sm" align="center">
                  <Ionicons name="time-outline" size={16} color={colors.text.faint} />
                  <Text variant="caption" tone="faint" style={styles.flex}>
                    {t('spending.pendingRaise', { when: formatWhen(data.pending.appliesAt) })}
                  </Text>
                </Row>
              )}
              <Text variant="caption" tone="faint">
                {willDelay ? t('spending.raiseDelay') : t('spending.lowerNow')}
              </Text>
            </Column>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(240).delay(120)}>
            <Column gap="md">
              <Text variant="bodyStrong">{t('spending.pauseTitle')}</Text>
              <Text variant="caption" tone="secondary">
                {t('spending.pauseBody')}
              </Text>
              <PauseState status={data} />
              <Column gap="sm">
                {PAUSE_OPTIONS.filter((option) => option.value !== 'none' || !data.excluded).map(
                  (option) => {
                    const selected = draft.exclusion === option.value;
                    const locked = data.excludedPermanently;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => choosePause(option.value)}
                        disabled={locked}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled: locked }}
                        style={({ pressed }) => [
                          styles.option,
                          selected && styles.optionSelected,
                          locked && styles.optionLocked,
                          pressed && !locked && styles.optionPressed,
                        ]}
                        testID={`pause-${option.value}`}
                      >
                        <Ionicons
                          name={selected ? 'radio-button-on' : 'radio-button-off'}
                          size={20}
                          color={selected ? colors.brand.solid : colors.text.faint}
                        />
                        <Text variant="body" tone={locked ? 'faint' : 'primary'}>
                          {t(option.label)}
                        </Text>
                      </Pressable>
                    );
                  },
                )}
              </Column>
            </Column>
          </Animated.View>

          {save.isError && (
            <Animated.View entering={FadeIn.duration(160)}>
              <Banner message={errorMessage(save.error)} />
            </Animated.View>
          )}
          {saved && !dirty && (
            <Animated.View entering={FadeIn.duration(160)}>
              <Banner message={t('spending.saved')} tone="info" testID="spending-saved" />
            </Animated.View>
          )}

          <Button
            label={t('spending.save')}
            onPress={() => void submit()}
            disabled={!canSave}
            loading={save.isPending}
            size="lg"
            fullWidth
            testID="spending-save"
          />
        </ScrollView>
      )}

      <Sheet ref={confirm} title={t('spending.foreverTitle')}>
        <Text variant="body" tone="secondary">
          {t('spending.foreverBody')}
        </Text>
        <Column gap="sm">
          <Button
            label={t('spending.foreverConfirm')}
            onPress={() => {
              confirm.current?.dismiss();
              if (draft) setDraft({ ...draft, exclusion: 'permanent' });
            }}
            variant="danger"
            fullWidth
            testID="pause-forever-confirm"
          />
          <Button
            label={t('common.cancel')}
            onPress={() => confirm.current?.dismiss()}
            variant="ghost"
            fullWidth
          />
        </Column>
      </Sheet>
    </Screen>
  );
}

function Spent({
  label,
  value,
  cap,
  capLabel,
}: {
  label: string;
  value: string;
  cap: number | null;
  capLabel: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <Column gap="xs" flex={1}>
      <Text variant="micro" tone="secondary">
        {label}
      </Text>
      <Text variant="heading" style={styles.spent}>
        {value}
      </Text>
      <Text variant="micro" tone="faint">
        {cap === null
          ? capLabel('spending.noLimit')
          : capLabel('spending.ofLimit', { coins: formatCoins(coins(cap)) })}
      </Text>
    </Column>
  );
}

function PauseState({ status }: { status: SpendStatus }) {
  const { t } = useTranslation();
  if (status.excludedPermanently) {
    return <Banner message={t('spending.pausedForever')} tone="warning" testID="pause-state" />;
  }
  if (status.excluded && status.excludedUntil) {
    return (
      <Banner
        message={t('spending.pausedUntil', { when: formatWhen(status.excludedUntil) })}
        tone="warning"
        testID="pause-state"
      />
    );
  }
  return null;
}

/** A date and time in the reader's locale. The server sends ISO and nothing else. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  gutter: { paddingHorizontal: spacing.lg },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  spent: { color: colors.currency.coin },
  coolingOff: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.subtle,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.subtle,
    backgroundColor: colors.bg.surface,
  },
  optionSelected: { borderColor: colors.brand.solid },
  optionLocked: { opacity: 0.5 },
  optionPressed: { opacity: 0.8 },
});
