// Coins into gems — one way, with the bonus.
//
// Offered where someone is short of gems, because that is the only moment it
// means anything. The rate and minimum come from the server with the catalog;
// the number shown is the server's own arithmetic, so what the user reads is
// what they receive.
//
// It says ONE WAY out loud. Gems never turn back into coins, and a user who
// converts a whale-sized balance believing otherwise is a support ticket and a
// grievance.

import { randomUUID } from 'expo-crypto';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { useConvertCoins } from '@/api/queries/useWallet';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { IntentKeys } from '@/lib/intentKeys';
import { formatCoins, formatGems } from '@/lib/money';
import { coins as asCoins, gems as asGems } from '@/lib/units';
import { spacing } from '@/theme';
import { Banner, Button, Chip, Column, Sheet, Text, type SheetHandle } from '@/ui';
import { gemsForCoins } from './ownership';

const PRESETS = [1_000, 5_000, 10_000, 50_000];

export interface ConvertSheetProps {
  ref?: Ref<SheetHandle>;
  coinBalance: number;
  rateBp: number;
  minimumCoins: number;
  /** When known, the sheet suggests exactly enough to cover it. */
  gemsNeeded?: number;
}

export function ConvertSheet({
  ref,
  coinBalance,
  rateBp,
  minimumCoins,
  gemsNeeded,
}: ConvertSheetProps) {
  const { t } = useTranslation();
  const sheet = useRef<SheetHandle>(null);
  const convert = useConvertCoins();
  const [keys] = useState(() => new IntentKeys(randomUUID));
  const [amount, setAmount] = useState<number | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [done, setDone] = useState<number | null>(null);

  // The fewest coins that cover the shortfall — rounded up, since the server
  // floors and a suggestion that lands one gem short would be a small insult.
  const suggested =
    gemsNeeded !== undefined && gemsNeeded > 0
      ? Math.max(minimumCoins, Math.ceil((gemsNeeded * 10_000) / rateBp))
      : null;

  useImperativeHandle(ref, () => ({
    present: () => {
      setFailure(null);
      setDone(null);
      setAmount(null);
      sheet.current?.present();
    },
    dismiss: () => sheet.current?.dismiss(),
  }));

  const options = [
    ...(suggested !== null && suggested <= coinBalance ? [suggested] : []),
    ...PRESETS.filter((preset) => preset <= coinBalance && preset !== suggested),
  ];
  const chosen = amount ?? options[0] ?? null;
  const tooSmall = chosen !== null && chosen < minimumCoins;

  async function submit() {
    if (chosen === null || tooSmall) return;
    const signature = `convert:${chosen}`;
    const key = keys.begin(signature);
    haptic.tap();
    setFailure(null);

    try {
      const result = await convert.mutateAsync({ coins: chosen, idempotencyKey: key });
      keys.settle(signature, key, null);
      haptic.success();
      setDone(result.gemsReceived);
    } catch (error) {
      keys.settle(signature, key, error);
      haptic.error();
      setFailure(error);
    }
  }

  return (
    <Sheet ref={sheet} title={t('store.convertTitle')}>
      {done !== null ? (
        <Column gap="md">
          <Text variant="body">{t('store.convertDone', { gems: formatGems(asGems(done)) })}</Text>
          <Button label={t('common.done')} onPress={() => sheet.current?.dismiss()} fullWidth />
        </Column>
      ) : options.length === 0 ? (
        <Text variant="body" tone="secondary">
          {t('store.convertNoCoins', { coins: formatCoins(asCoins(minimumCoins)) })}
        </Text>
      ) : (
        <Column gap="md">
          <Text variant="caption" tone="secondary">
            {t('store.convertOneWay', { bonus: Math.round((rateBp - 10_000) / 100) })}
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {options.map((value) => (
              <Chip
                key={value}
                label={formatCoins(asCoins(value))}
                selected={value === chosen}
                onPress={() => {
                  haptic.selection();
                  setAmount(value);
                  setFailure(null);
                }}
              />
            ))}
          </ScrollView>

          {chosen !== null && (
            <Text variant="heading">
              {t('store.convertResult', {
                coins: formatCoins(asCoins(chosen)),
                gems: formatGems(asGems(gemsForCoins(chosen, rateBp))),
              })}
            </Text>
          )}

          {failure !== null && <Banner message={errorMessage(failure)} />}

          <Button
            label={t('store.convertAction')}
            onPress={() => void submit()}
            loading={convert.isPending}
            disabled={chosen === null || tooSmall}
            size="lg"
            fullWidth
            testID="confirm-convert"
          />
        </Column>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { gap: spacing.sm },
});
