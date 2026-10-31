import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useClaimTask, useDailyTasks, useRecordShare } from '@/api/queries/useGrowth';
import type { DailyTask, TaskKind } from '@/api/types';
import { useAppConfig } from '@/features/config/useAppConfig';
import { useTranslation, type MessageKey } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins } from '@/lib/money';
import { coins } from '@/lib/units';
import { colors, radius, spacing } from '@/theme';
import { Banner, Button, Card, Column, Row, Skeleton, Text } from '@/ui';

const KIND_ICON: Record<TaskKind, keyof typeof Ionicons.glyphMap> = {
  watch_minutes: 'headset',
  chat: 'chatbubble-ellipses',
  gifts: 'gift',
  follows: 'heart',
  share: 'share-social',
};
const KIND_LABEL: Record<TaskKind, MessageKey> = {
  watch_minutes: 'rewards.taskWatch',
  chat: 'rewards.taskChat',
  gifts: 'rewards.taskGifts',
  follows: 'rewards.taskFollows',
  share: 'rewards.taskShare',
};

/**
 * Today's tasks — the second daily hook after the check-in.
 *
 * Progress is the server's reading of the day; the card never counts anything
 * itself. A finished task shows Claim, a claimed one shows Done, and an
 * unfinished one takes you where it happens. Share is the exception: the
 * phone's share sheet is where it happens, so the button opens it and tells
 * the server when it closes.
 */
export function TasksCard() {
  const { t } = useTranslation();
  const tasks = useDailyTasks();
  const claim = useClaimTask();
  const share = useRecordShare();
  const { shareBaseUrl } = useAppConfig();

  async function doShare() {
    haptic.tap();
    try {
      const result = await Share.share({
        message: t('rewards.taskShareMessage', { url: shareBaseUrl || 'https://dhun.live' }),
      });
      if (result.action === Share.sharedAction) share.mutate();
    } catch {
      // The sheet was closed. Nothing to record.
    }
  }

  function go(task: DailyTask) {
    haptic.tap();
    if (task.kind === 'share') {
      void doShare();
      return;
    }
    // Everything else happens in a room or on a profile.
    router.navigate('/(app)/(tabs)');
  }

  if (tasks.isError) {
    return <Banner message={errorMessage(tasks.error)} onRetry={() => void tasks.refetch()} />;
  }
  if (tasks.data === undefined) return <Skeleton height={200} rounding="lg" />;
  if (tasks.data.tasks.length === 0) return null;

  return (
    <Animated.View entering={FadeInDown.duration(240).delay(40)}>
      <Card>
        <Column gap="md">
          <Column gap="xs">
            <Text variant="heading">{t('rewards.tasksTitle')}</Text>
            <Text variant="caption" tone="secondary">
              {t('rewards.tasksBody')}
            </Text>
          </Column>

          {claim.isError && <Banner message={errorMessage(claim.error)} />}

          <Column gap="sm">
            {tasks.data.tasks.map((task) => {
              const done = task.progress >= task.target;
              const ratio = task.target === 0 ? 1 : Math.min(1, task.progress / task.target);
              return (
                <View key={task.id} style={styles.task} testID={`task-${task.id}`}>
                  <View style={[styles.icon, task.claimed && styles.iconDone]}>
                    <Ionicons
                      name={task.claimed ? 'checkmark' : KIND_ICON[task.kind]}
                      size={16}
                      color={task.claimed ? colors.text.onBrand : colors.brand.accent}
                    />
                  </View>
                  <Column gap="xs" flex={1}>
                    <Row justify="between" align="center">
                      <Text variant="bodyStrong" numberOfLines={1} style={styles.label}>
                        {t(KIND_LABEL[task.kind], { n: task.target })}
                      </Text>
                      <Text variant="caption" style={styles.coins}>
                        +{formatCoins(coins(task.coins))}
                      </Text>
                    </Row>
                    <View
                      style={styles.track}
                      accessible
                      accessibilityRole="progressbar"
                      accessibilityValue={{ min: 0, max: task.target, now: task.progress }}
                    >
                      <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
                    </View>
                    <Text variant="micro" tone="faint">
                      {task.claimed
                        ? t('rewards.taskClaimed')
                        : t('rewards.taskProgress', { done: task.progress, total: task.target })}
                    </Text>
                  </Column>
                  {!task.claimed && (
                    <Button
                      label={done ? t('rewards.claim') : t('rewards.taskGo')}
                      onPress={() =>
                        done
                          ? claim.mutate(task.id, {
                              onSuccess: () => haptic.success(),
                              onError: () => haptic.error(),
                            })
                          : go(task)
                      }
                      variant={done ? 'primary' : 'ghost'}
                      size="sm"
                      loading={claim.isPending && claim.variables === task.id}
                      testID={`task-action-${task.id}`}
                    />
                  )}
                </View>
              );
            })}
          </Column>
        </Column>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  task: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand.soft,
  },
  iconDone: { backgroundColor: colors.status.success },
  label: { flex: 1 },
  coins: { color: colors.currency.coin, fontWeight: '700' },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.raised,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.brand.accent },
});
