import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useAgencyTransfers, useInventory, useMyAgency } from '@/api/queries/useAgency';
import { TransferRow } from '@/features/agency/TransferRow';
import { TransferSheet } from '@/features/agency/TransferSheet';
import { useTranslation } from '@/i18n';
import { errorCode, errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { formatCoins } from '@/lib/money';
import { coins as asCoins } from '@/lib/units';
import { colors, radius, spacing } from '@/theme';
import {
  Banner,
  Button,
  Card,
  Column,
  Divider,
  EmptyState,
  Row,
  Screen,
  Skeleton,
  Text,
  type SheetHandle,
} from '@/ui';

/**
 * The agency's coin stock, and sending it on.
 *
 * Owner-only and gated on the coin-trading grant, so the first thing this
 * screen does is tell an agency without it why there is nothing here — rather
 * than showing an empty wallet and letting them guess.
 */
export default function AgencyCoinsScreen() {
  const { t, locale } = useTranslation();
  const agency = useMyAgency();
  const isOwner = agency.data?.seat?.isOwner === true;
  const inventory = useInventory(isOwner);
  const transfers = useAgencyTransfers(isOwner);
  const sheet = useRef<SheetHandle>(null);

  const notTrading = errorCode(inventory.error) === 'COIN_TRADING_DISABLED';

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
        <Text variant="heading">{t('agencyCoins.inventoryTitle')}</Text>
      </Row>

      {notTrading ? (
        <View style={styles.centre}>
          <EmptyState
            icon="lock-closed-outline"
            title={t('agencyCoins.notTradingTitle')}
            body={t('agencyCoins.notTradingBody')}
          />
        </View>
      ) : inventory.isError ? (
        <View style={styles.gutter}>
          <Banner
            message={errorMessage(inventory.error)}
            onRetry={() => void inventory.refetch()}
          />
        </View>
      ) : inventory.data === undefined ? (
        <Column gap="lg" style={styles.gutter}>
          <Skeleton height={160} rounding="lg" />
          <Skeleton height={120} rounding="lg" />
        </Column>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.duration(220)}>
            <Card>
              <Column gap="md">
                <Column gap="xs">
                  <Text variant="micro" tone="faint">
                    {inventory.data.agency.name}
                  </Text>
                  <Text variant="display" testID="inventory-coins">
                    {formatCoins(asCoins(inventory.data.coins))}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {t('agencyCoins.inventoryBody')}
                  </Text>
                </Column>

                <Divider />
                <Column gap="xs">
                  <Text variant="caption" tone="secondary">
                    {t('agencyCoins.usedToday', {
                      coins: formatCoins(asCoins(inventory.data.usedToday.coins)),
                      count: inventory.data.usedToday.count,
                    })}
                  </Text>
                  <Text variant="caption" tone="faint">
                    {t('agencyCoins.perTransfer', {
                      coins: formatCoins(asCoins(inventory.data.caps.perTransferMaxCoins)),
                    })}
                  </Text>
                </Column>

                {inventory.data.isNewAgency && (
                  <Row gap="sm" style={styles.notice} align="start">
                    <Ionicons
                      name="information-circle-outline"
                      size={18}
                      color={colors.text.secondary}
                    />
                    <Text variant="caption" tone="secondary" style={styles.shrink}>
                      {t('agencyCoins.newAgencyCaps')}
                    </Text>
                  </Row>
                )}

                <Button
                  label={t('agencyCoins.transferTitle')}
                  onPress={() => {
                    haptic.selection();
                    sheet.current?.present();
                  }}
                  disabled={inventory.data.coins === 0}
                  fullWidth
                  testID="open-transfer"
                />
              </Column>
            </Card>
          </Animated.View>

          <Card>
            <Column gap="md">
              <Text variant="heading">{t('agencyCoins.historyTitle')}</Text>
              {transfers.isError ? (
                <Banner
                  message={errorMessage(transfers.error)}
                  onRetry={() => void transfers.refetch()}
                />
              ) : transfers.data === undefined ? (
                <Skeleton height={44} rounding="md" />
              ) : transfers.data.length === 0 ? (
                <Text variant="caption" tone="secondary">
                  {t('agencyCoins.historyEmpty')}
                </Text>
              ) : (
                transfers.data.map((transfer, i) => (
                  <Column key={transfer.id} gap="sm">
                    {i > 0 && <Divider />}
                    <TransferRow transfer={transfer} locale={locale} outgoing />
                  </Column>
                ))
              )}
            </Column>
          </Card>
        </ScrollView>
      )}

      {inventory.data !== undefined && <TransferSheet ref={sheet} inventory={inventory.data} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { height: 52, paddingHorizontal: spacing.lg },
  gutter: { paddingHorizontal: spacing.lg },
  centre: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  shrink: { flexShrink: 1 },
  notice: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg.raised,
  },
});
