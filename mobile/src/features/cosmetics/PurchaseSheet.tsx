// Confirming a cosmetic purchase.
//
// Unlike a gift, this one asks first. A gift is a small, social, repeated tap
// and a confirmation would kill the combo; a frame is thousands of gems spent
// once, on something the user will look at for a month. Saying exactly what
// they get — how many days, how many gems left after — is the whole job here.

import { randomUUID } from 'expo-crypto';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';

import { ApiError } from '@/api/client';
import { usePurchaseCosmetic } from '@/api/queries/useCosmetics';
import { queryKeys } from '@/api/queries/keys';
import { ApiErrorCode, type Cosmetic } from '@/api/types';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { haptic } from '@/lib/haptics';
import { IntentKeys } from '@/lib/intentKeys';
import { formatGems } from '@/lib/money';
import { gems } from '@/lib/units';
import { Banner, Button, Column, Row, Sheet, Text, type SheetHandle } from '@/ui';
import { ItemSwatch } from './ItemSwatch';
import type { ItemStatus } from './ownership';

export interface PurchaseSheetProps {
  ref?: Ref<SheetHandle>;
  item: Cosmetic | null;
  status: ItemStatus;
  /** Null while the balance is loading. */
  balance: number | null;
  /** For the swatch — the viewer's own name inside the frame. */
  viewerName: string;
}

export function PurchaseSheet({ ref, item, status, balance, viewerName }: PurchaseSheetProps) {
  const { t, tPlural } = useTranslation();
  const queryClient = useQueryClient();
  const sheet = useRef<SheetHandle>(null);
  const purchase = usePurchaseCosmetic();
  const [keys] = useState(() => new IntentKeys(randomUUID));
  const [failure, setFailure] = useState<unknown>(null);

  useImperativeHandle(ref, () => ({
    present: () => {
      setFailure(null);
      sheet.current?.present();
    },
    dismiss: () => sheet.current?.dismiss(),
  }));

  if (!item) return <Sheet ref={sheet}>{null}</Sheet>;

  const days = item.durationDays ?? 0;
  const after = balance === null ? null : balance - item.gemPrice;

  async function confirm() {
    if (!item) return;
    // The price is part of the intent: a retry after a reprice is a new
    // decision, not the same purchase retried.
    const signature = `buy:${item.id}:${item.gemPrice}`;
    const key = keys.begin(signature);
    haptic.tap();
    setFailure(null);

    try {
      await purchase.mutateAsync({
        cosmeticId: item.id,
        expectedGemPrice: item.gemPrice,
        idempotencyKey: key,
      });
      keys.settle(signature, key, null);
      haptic.success();
      sheet.current?.dismiss();
    } catch (error) {
      keys.settle(signature, key, error);
      haptic.error();
      setFailure(error);
      if (error instanceof ApiError && error.code === ApiErrorCode.COSMETIC_PRICE_CHANGED) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.cosmetics() });
      }
    }
  }

  return (
    <Sheet ref={sheet} title={item.name}>
      <Row gap="lg">
        <ItemSwatch item={item} name={viewerName} />
        <Column gap="xs" flex={1}>
          <Text variant="heading">
            {t('store.gemsAmount', { gems: formatGems(gems(item.gemPrice)) })}
          </Text>
          <Text variant="caption" tone="secondary">
            {status.kind === 'wearing' || status.kind === 'owned'
              ? // Said plainly, because "buy" on something already owned reads
                // like a double charge unless it says what it adds.
                tPlural('store.extendNoteDay', 'store.extendNoteDays', days)
              : tPlural('store.startsNowDay', 'store.startsNowDays', days)}
          </Text>
        </Column>
      </Row>

      {after !== null && after >= 0 && (
        <Text variant="caption" tone="secondary">
          {t('store.balanceAfter', { gems: formatGems(gems(after)) })}
        </Text>
      )}

      {failure !== null && (
        <Banner
          message={
            failure instanceof ApiError && failure.code === ApiErrorCode.INSUFFICIENT_BALANCE
              ? t('store.notEnoughGems')
              : errorMessage(failure)
          }
        />
      )}

      <Column gap="sm">
        <Button
          label={t('store.confirmBuy', { gems: formatGems(gems(item.gemPrice)) })}
          onPress={() => void confirm()}
          loading={purchase.isPending}
          size="lg"
          fullWidth
          testID="confirm-cosmetic-purchase"
        />
        <Button
          label={t('common.cancel')}
          onPress={() => sheet.current?.dismiss()}
          variant="ghost"
          fullWidth
        />
      </Column>
    </Sheet>
  );
}
